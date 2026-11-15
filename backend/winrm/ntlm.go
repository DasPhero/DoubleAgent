package winrm

import (
	"bytes"
	"crypto/hmac"
	"crypto/md5"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf16"

	"golang.org/x/crypto/md4" //nolint:staticcheck // Required by MS-NLMP (NTLMv2) specification
)

const (
	ntlmSignature = "NTLMSSP\x00"

	ntlmMsgNegotiate    uint32 = 1
	ntlmMsgChallenge    uint32 = 2
	ntlmMsgAuthenticate uint32 = 3

	flagNegotiateUnicode        uint32 = 0x00000001
	flagNegotiateOEM            uint32 = 0x00000002
	flagRequestTarget           uint32 = 0x00000004
	flagNegotiateNTLM           uint32 = 0x00000200
	flagNegotiateAlwaysSign     uint32 = 0x00008000
	flagNegotiateExtendedSec    uint32 = 0x00080000
	flagNegotiateTargetInfo     uint32 = 0x00800000
	flagNegotiateVersion        uint32 = 0x02000000
	flagNegotiate128            uint32 = 0x20000000
	flagNegotiate56             uint32 = 0x80000000
)

func encodeUTF16LE(s string) []byte {
	u := utf16.Encode([]rune(s))
	buf := make([]byte, len(u)*2)
	for i, c := range u {
		binary.LittleEndian.PutUint16(buf[i*2:], c)
	}
	return buf
}

// ntHashFromPassword computes the 16-byte MD4(UTF16LE(password)) NT hash.
func ntHashFromPassword(password string) []byte {
	h := md4.New()
	_, _ = h.Write(encodeUTF16LE(password))
	return h.Sum(nil)
}

func hmacMD5(key, data []byte) []byte {
	m := hmac.New(md5.New, key)
	_, _ = m.Write(data)
	return m.Sum(nil)
}

// buildNtlmNegotiateMessage constructs an MS-NLMP Type 1 NEGOTIATE_MESSAGE.
func buildNtlmNegotiateMessage() []byte {
	flags := flagNegotiateUnicode |
		flagNegotiateOEM |
		flagRequestTarget |
		flagNegotiateNTLM |
		flagNegotiateAlwaysSign |
		flagNegotiateExtendedSec |
		flagNegotiate128 |
		flagNegotiate56

	buf := make([]byte, 32)
	copy(buf[:8], ntlmSignature)
	binary.LittleEndian.PutUint32(buf[8:12], ntlmMsgNegotiate)
	binary.LittleEndian.PutUint32(buf[12:16], flags)
	// Empty DomainNameFields (16..24) and WorkstationFields (24..32)
	return buf
}

type ntlmChallenge struct {
	ServerChallenge [8]byte
	Flags           uint32
	TargetInfo      []byte
}

// parseNtlmChallenge decodes an MS-NLMP Type 2 CHALLENGE_MESSAGE.
func parseNtlmChallenge(raw []byte) (*ntlmChallenge, error) {
	if len(raw) < 32 {
		return nil, fmt.Errorf("NTLM Type 2 challenge too short (%d bytes)", len(raw))
	}
	if string(raw[:8]) != ntlmSignature {
		return nil, errors.New("invalid NTLMSSP Type 2 signature")
	}
	msgType := binary.LittleEndian.Uint32(raw[8:12])
	if msgType != ntlmMsgChallenge {
		return nil, fmt.Errorf("expected NTLM Type 2 challenge, got type %d", msgType)
	}

	flags := binary.LittleEndian.Uint32(raw[20:24])
	var ch ntlmChallenge
	ch.Flags = flags
	copy(ch.ServerChallenge[:], raw[24:32])

	if (flags&flagNegotiateTargetInfo) != 0 && len(raw) >= 48 {
		tiLen := int(binary.LittleEndian.Uint16(raw[40:42]))
		tiOff := int(binary.LittleEndian.Uint32(raw[44:48]))
		if tiLen > 0 && tiOff >= 48 && tiOff+tiLen <= len(raw) {
			ch.TargetInfo = append([]byte(nil), raw[tiOff:tiOff+tiLen]...)
		}
	}
	return &ch, nil
}

// buildNtlmAuthenticate computes an MS-NLMP Type 3 NTLMv2 AUTHENTICATE_MESSAGE.
// Supports both plaintext password and direct 16-byte NT hash (Pass-the-Hash).
func buildNtlmAuthenticate(ch *ntlmChallenge, domain, user, password string, rawNtHash []byte, workstation string) ([]byte, error) {
	var ntHash []byte
	if len(rawNtHash) == 16 {
		ntHash = rawNtHash
	} else {
		ntHash = ntHashFromPassword(password)
	}

	// ResponseKeyNT = HMAC_MD5(ntHash, UNICODE(UPPER(user) + domain))
	identity := encodeUTF16LE(strings.ToUpper(user) + domain)
	responseKeyNT := hmacMD5(ntHash, identity)

	var clientChallenge [8]byte
	if _, err := rand.Read(clientChallenge[:]); err != nil {
		return nil, err
	}

	// Windows FILETIME: 100-nanosecond intervals since 1601-01-01
	winEpochDiff := uint64(116444736000000000)
	fileTime := uint64(time.Now().UTC().UnixNano()/100) + winEpochDiff

	targetInfo := ch.TargetInfo
	if len(targetInfo) == 0 {
		// Minimal MsvAvEOL terminator
		targetInfo = []byte{0, 0, 0, 0}
	}

	// NTLMv2 Temp Blob per MS-NLMP 3.3.2
	tempLen := 28 + len(targetInfo)
	temp := make([]byte, tempLen)
	temp[0] = 0x01 // RespType
	temp[1] = 0x01 // HiRespType
	binary.LittleEndian.PutUint64(temp[8:16], fileTime)
	copy(temp[16:24], clientChallenge[:])
	copy(temp[28:], targetInfo)

	// NTProofStr = HMAC_MD5(ResponseKeyNT, ServerChallenge + Temp)
	proofInput := make([]byte, 8+len(temp))
	copy(proofInput[:8], ch.ServerChallenge[:])
	copy(proofInput[8:], temp)
	ntProofStr := hmacMD5(responseKeyNT, proofInput)

	ntChallengeResp := make([]byte, len(ntProofStr)+len(temp))
	copy(ntChallengeResp[:16], ntProofStr)
	copy(ntChallengeResp[16:], temp)

	// LMv2 response (minimal 24 bytes: HMAC(ResponseKeyNT, ServerChallenge + ClientChallenge) + ClientChallenge)
	lmInput := make([]byte, 16)
	copy(lmInput[:8], ch.ServerChallenge[:])
	copy(lmInput[8:], clientChallenge[:])
	lmChallengeResp := append(hmacMD5(responseKeyNT, lmInput), clientChallenge[:]...)

	domainBytes := encodeUTF16LE(domain)
	userBytes := encodeUTF16LE(user)
	wsBytes := encodeUTF16LE(workstation)

	headerLen := 88
	var payload bytes.Buffer

	writeSecBuf := func(hdr []byte, hdrOffset int, data []byte) {
		l := uint16(len(data))
		off := uint32(headerLen + payload.Len())
		binary.LittleEndian.PutUint16(hdr[hdrOffset:], l)
		binary.LittleEndian.PutUint16(hdr[hdrOffset+2:], l)
		binary.LittleEndian.PutUint32(hdr[hdrOffset+4:], off)
		payload.Write(data)
	}

	hdr := make([]byte, headerLen)
	copy(hdr[:8], ntlmSignature)
	binary.LittleEndian.PutUint32(hdr[8:12], ntlmMsgAuthenticate)

	writeSecBuf(hdr, 12, lmChallengeResp)
	writeSecBuf(hdr, 20, ntChallengeResp)
	writeSecBuf(hdr, 28, domainBytes)
	writeSecBuf(hdr, 36, userBytes)
	writeSecBuf(hdr, 44, wsBytes)
	// EncryptedRandomSessionKey (52..60): empty
	binary.LittleEndian.PutUint32(hdr[60:64], (ch.Flags&flagNegotiateUnicode)|flagNegotiateNTLM|flagNegotiateExtendedSec|flagNegotiateAlwaysSign|flagNegotiate128)

	out := make([]byte, headerLen+payload.Len())
	copy(out[:headerLen], hdr)
	copy(out[headerLen:], payload.Bytes())
	return out, nil
}

// ntlmTransport wraps a base http.RoundTripper (requiring keep-alive connection pooling)
// and transparently negotiates 3-step MS-NLMP HTTP authentication on 401 NTLM challenges.
type ntlmTransport struct {
	base      http.RoundTripper
	domain    string
	username  string
	password  string
	ntHash    []byte
	negotiated string
}

func (t *ntlmTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	var bodyBytes []byte
	if req.Body != nil {
		var err error
		bodyBytes, err = io.ReadAll(req.Body)
		_ = req.Body.Close()
		if err != nil {
			return nil, err
		}
	}

	cloneWithBody := func() *http.Request {
		r := req.Clone(req.Context())
		if len(bodyBytes) > 0 {
			r.Body = io.NopCloser(bytes.NewReader(bodyBytes))
			r.ContentLength = int64(len(bodyBytes))
		} else if req.Method == http.MethodPost {
			r.Body = http.NoBody
		}
		return r
	}

	// Step 1: Try initial request (empty or already authenticated keep-alive connection)
	firstReq := cloneWithBody()
	resp, err := t.base.RoundTrip(firstReq)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusUnauthorized {
		return resp, nil
	}

	// Only start NTLM handshake if server advertises NTLM or Negotiate
	authHeaders := resp.Header.Values("WWW-Authenticate")
	acceptsNTLM := false
	for _, h := range authHeaders {
		lower := strings.ToLower(h)
		if strings.Contains(lower, "ntlm") || strings.Contains(lower, "negotiate") {
			acceptsNTLM = true
			break
		}
	}
	if !acceptsNTLM {
		return resp, nil
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()

	// Step 2: Send NTLM Type 1 Negotiate (send empty body or probe)
	negReq := cloneWithBody()
	negMsg := base64.StdEncoding.EncodeToString(buildNtlmNegotiateMessage())
	negReq.Header.Set("Authorization", "NTLM "+negMsg)
	negResp, err := t.base.RoundTrip(negReq)
	if err != nil {
		return nil, err
	}
	if negResp.StatusCode != http.StatusUnauthorized {
		return negResp, nil
	}

	var challengeB64 string
	for _, h := range negResp.Header.Values("WWW-Authenticate") {
		fields := strings.Fields(h)
		if len(fields) >= 2 && strings.EqualFold(fields[0], "NTLM") {
			challengeB64 = fields[1]
			break
		}
	}
	_, _ = io.Copy(io.Discard, negResp.Body)
	_ = negResp.Body.Close()

	if challengeB64 == "" {
		return nil, errors.New("server rejected NTLM Type 1 without returning Type 2 challenge")
	}
	challengeRaw, err := base64.StdEncoding.DecodeString(challengeB64)
	if err != nil {
		return nil, fmt.Errorf("invalid base64 NTLM challenge: %w", err)
	}
	ch, err := parseNtlmChallenge(challengeRaw)
	if err != nil {
		return nil, err
	}

	// Step 3: Compute NTLMv2 Type 3 Authenticate and resend SOAP request on same keep-alive connection
	authRaw, err := buildNtlmAuthenticate(ch, t.domain, t.username, t.password, t.ntHash, "DOUBLEAGENT")
	if err != nil {
		return nil, err
	}
	authReq := cloneWithBody()
	authReq.Header.Set("Authorization", "NTLM "+base64.StdEncoding.EncodeToString(authRaw))
	return t.base.RoundTrip(authReq)
}
