package ssh

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"
	gossh "golang.org/x/crypto/ssh"

	"doubleagent/backend/core"
)

// GenerateKeyPair generates a new Ed25519 or RSA-3072 SSH keypair and returns a Vault-ready SshKeyRecord (F-04).
func GenerateKeyPair(label, keyType, passphrase string) (core.SshKeyRecord, error) {
	cleanLabel := strings.TrimSpace(label)
	if cleanLabel == "" {
		cleanLabel = "doubleagent-key"
	}
	normType := strings.ToLower(strings.TrimSpace(keyType))
	if normType == "" {
		normType = "ed25519"
	}

	var privKey any
	switch normType {
	case "ed25519":
		_, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return core.SshKeyRecord{}, fmt.Errorf("generate ed25519 key: %w", err)
		}
		privKey = priv
	case "rsa":
		priv, err := rsa.GenerateKey(rand.Reader, 3072)
		if err != nil {
			return core.SshKeyRecord{}, fmt.Errorf("generate rsa key: %w", err)
		}
		privKey = priv
	default:
		return core.SshKeyRecord{}, fmt.Errorf("unsupported key type %q (expected ed25519 or rsa)", keyType)
	}

	return marshalKeyRecord(cleanLabel, normType, privKey, passphrase)
}

// ImportPrivateKey imports an OpenSSH PEM private key or a PuTTY .ppk (v2/v3) file into a Vault-ready SshKeyRecord (F-04).
func ImportPrivateKey(label, rawKey, passphrase string) (core.SshKeyRecord, error) {
	trimmed := strings.TrimSpace(rawKey)
	if trimmed == "" {
		return core.SshKeyRecord{}, errors.New("private key content is empty")
	}

	if strings.HasPrefix(trimmed, "PuTTY-User-Key-File-") {
		privKey, keyType, comment, err := parsePuTTYPPK(trimmed, passphrase)
		if err != nil {
			return core.SshKeyRecord{}, err
		}
		useLabel := strings.TrimSpace(label)
		if useLabel == "" {
			useLabel = comment
		}
		if useLabel == "" {
			useLabel = "imported-ppk"
		}
		return marshalKeyRecord(useLabel, keyType, privKey, passphrase)
	}

	var parsed any
	var err error
	if passphrase != "" {
		parsed, err = gossh.ParseRawPrivateKeyWithPassphrase([]byte(trimmed), []byte(passphrase))
	} else {
		parsed, err = gossh.ParseRawPrivateKey([]byte(trimmed))
	}
	if err != nil {
		return core.SshKeyRecord{}, fmt.Errorf("parse private key: %w", err)
	}

	signer, err := gossh.NewSignerFromKey(parsed)
	if err != nil {
		return core.SshKeyRecord{}, fmt.Errorf("create signer from imported key: %w", err)
	}

	useLabel := strings.TrimSpace(label)
	if useLabel == "" {
		useLabel = "imported-key"
	}
	pub := signer.PublicKey()
	authKey := strings.TrimSpace(string(gossh.MarshalAuthorizedKey(pub))) + " " + useLabel
	keyType := shortKeyType(pub.Type())

	return core.SshKeyRecord{
		ID:          fmt.Sprintf("key-%d", time.Now().UTC().UnixNano()),
		Label:       useLabel,
		Type:        keyType,
		PublicKey:   authKey,
		PrivateKey:  trimmed,
		Passphrase:  passphrase,
		Fingerprint: gossh.FingerprintSHA256(pub),
	}, nil
}

func marshalKeyRecord(label, keyType string, privKey any, passphrase string) (core.SshKeyRecord, error) {
	signer, err := gossh.NewSignerFromKey(privKey)
	if err != nil {
		return core.SshKeyRecord{}, fmt.Errorf("create ssh signer: %w", err)
	}

	var pemBlock *pem.Block
	if passphrase != "" {
		pemBlock, err = gossh.MarshalPrivateKeyWithPassphrase(privKey, label, []byte(passphrase))
	} else {
		pemBlock, err = gossh.MarshalPrivateKey(privKey, label)
	}
	if err != nil {
		return core.SshKeyRecord{}, fmt.Errorf("marshal openssh private key: %w", err)
	}

	pemBytes := pem.EncodeToMemory(pemBlock)
	pub := signer.PublicKey()
	authKey := strings.TrimSpace(string(gossh.MarshalAuthorizedKey(pub))) + " " + label

	return core.SshKeyRecord{
		ID:          fmt.Sprintf("key-%d", time.Now().UTC().UnixNano()),
		Label:       label,
		Type:        keyType,
		PublicKey:   authKey,
		PrivateKey:  string(pemBytes),
		Passphrase:  passphrase,
		Fingerprint: gossh.FingerprintSHA256(pub),
	}, nil
}

func shortKeyType(sshAlgo string) string {
	switch sshAlgo {
	case gossh.KeyAlgoED25519:
		return "ed25519"
	case gossh.KeyAlgoRSA:
		return "rsa"
	default:
		return sshAlgo
	}
}

// parsePuTTYPPK parses PuTTY-User-Key-File-2 and PuTTY-User-Key-File-3 files (ssh-ed25519 and ssh-rsa),
// supporting both "Encryption: none" and "Encryption: aes256-cbc" (F-04).
func parsePuTTYPPK(content, passphrase string) (any, string, string, error) {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	if len(lines) < 5 {
		return nil, "", "", errors.New("invalid PuTTY .ppk file: too few lines")
	}

	headerLine := strings.TrimSpace(lines[0])
	var version int
	var algo string
	if strings.HasPrefix(headerLine, "PuTTY-User-Key-File-2:") {
		version = 2
		algo = strings.TrimSpace(strings.TrimPrefix(headerLine, "PuTTY-User-Key-File-2:"))
	} else if strings.HasPrefix(headerLine, "PuTTY-User-Key-File-3:") {
		version = 3
		algo = strings.TrimSpace(strings.TrimPrefix(headerLine, "PuTTY-User-Key-File-3:"))
	} else {
		return nil, "", "", fmt.Errorf("unsupported PuTTY .ppk version in %q", headerLine)
	}

	headers := make(map[string]string)
	var pubB64 strings.Builder
	var privB64 strings.Builder
	mode := ""
	remainingLines := 0

	for i := 1; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		if remainingLines > 0 {
			if mode == "public" {
				pubB64.WriteString(line)
			} else if mode == "private" {
				privB64.WriteString(line)
			}
			remainingLines--
			continue
		}

		colonIdx := strings.IndexByte(line, ':')
		if colonIdx == -1 {
			continue
		}
		k := strings.TrimSpace(line[:colonIdx])
		v := strings.TrimSpace(line[colonIdx+1:])
		headers[k] = v

		if k == "Public-Lines" {
			n := 0
			_, _ = fmt.Sscanf(v, "%d", &n)
			remainingLines = n
			mode = "public"
		} else if k == "Private-Lines" {
			n := 0
			_, _ = fmt.Sscanf(v, "%d", &n)
			remainingLines = n
			mode = "private"
		}
	}

	encryption := headers["Encryption"]
	comment := headers["Comment"]

	pubBlob, err := base64.StdEncoding.DecodeString(pubB64.String())
	if err != nil {
		return nil, "", "", fmt.Errorf("decode ppk public blob: %w", err)
	}
	privBlob, err := base64.StdEncoding.DecodeString(privB64.String())
	if err != nil {
		return nil, "", "", fmt.Errorf("decode ppk private blob: %w", err)
	}

	var macKey []byte
	switch encryption {
	case "none":
		if version == 2 {
			h := sha1.Sum([]byte("putty-private-key-file-mac-key"))
			macKey = h[:]
		} else {
			macKey = []byte{}
		}
	case "aes256-cbc":
		if passphrase == "" {
			return nil, "", "", errors.New("passphrase required for encrypted PuTTY .ppk key")
		}
		if len(privBlob)%aes.BlockSize != 0 {
			return nil, "", "", errors.New("invalid encrypted .ppk private blob length")
		}
		var cipherKey, iv []byte
		if version == 2 {
			cipherKey, iv, macKey = derivePPKv2Keys(passphrase)
		} else {
			cipherKey, iv, macKey, err = derivePPKv3Keys(passphrase, headers)
			if err != nil {
				return nil, "", "", err
			}
		}
		block, err := aes.NewCipher(cipherKey)
		if err != nil {
			return nil, "", "", err
		}
		decrypted := make([]byte, len(privBlob))
		cipher.NewCBCDecrypter(block, iv).CryptBlocks(decrypted, privBlob)
		privBlob = decrypted
	default:
		return nil, "", "", fmt.Errorf("unsupported PuTTY .ppk encryption %q", encryption)
	}

	// Verify Private-MAC if present
	if macHex := headers["Private-MAC"]; macHex != "" {
		macData := buildPPKMacData(algo, encryption, comment, pubBlob, privBlob)
		var computed []byte
		if version == 2 {
			m := hmac.New(sha1.New, macKey)
			_, _ = m.Write(macData)
			computed = m.Sum(nil)
		} else {
			m := hmac.New(sha256.New, macKey)
			_, _ = m.Write(macData)
			computed = m.Sum(nil)
		}
		if !strings.EqualFold(hex.EncodeToString(computed), macHex) {
			return nil, "", "", errors.New("invalid passphrase or corrupted PuTTY .ppk key (MAC mismatch)")
		}
	}

	switch algo {
	case "ssh-ed25519":
		pubReader := bytes.NewReader(pubBlob)
		kType, err := readSSHString(pubReader)
		if err != nil || string(kType) != "ssh-ed25519" {
			return nil, "", "", errors.New("invalid ssh-ed25519 public blob in .ppk")
		}
		pubBytes, err := readSSHString(pubReader)
		if err != nil || len(pubBytes) != ed25519.PublicKeySize {
			return nil, "", "", errors.New("invalid ed25519 public key length in .ppk")
		}
		privReader := bytes.NewReader(privBlob)
		seedBytes, err := readSSHString(privReader)
		if err != nil || len(seedBytes) != ed25519.SeedSize {
			return nil, "", "", errors.New("invalid ed25519 private seed in .ppk")
		}
		priv := ed25519.NewKeyFromSeed(seedBytes)
		if !bytes.Equal(priv.Public().(ed25519.PublicKey), pubBytes) {
			return nil, "", "", errors.New("ed25519 public key mismatch in .ppk")
		}
		return priv, "ed25519", comment, nil

	case "ssh-rsa":
		pubReader := bytes.NewReader(pubBlob)
		kType, err := readSSHString(pubReader)
		if err != nil || string(kType) != "ssh-rsa" {
			return nil, "", "", errors.New("invalid ssh-rsa public blob in .ppk")
		}
		eBytes, err := readSSHString(pubReader)
		if err != nil {
			return nil, "", "", err
		}
		nBytes, err := readSSHString(pubReader)
		if err != nil {
			return nil, "", "", err
		}
		privReader := bytes.NewReader(privBlob)
		dBytes, err := readSSHString(privReader)
		if err != nil {
			return nil, "", "", err
		}
		pBytes, err := readSSHString(privReader)
		if err != nil {
			return nil, "", "", err
		}
		qBytes, err := readSSHString(privReader)
		if err != nil {
			return nil, "", "", err
		}
		_, _ = readSSHString(privReader) // iqmp

		priv := &rsa.PrivateKey{
			PublicKey: rsa.PublicKey{
				N: new(big.Int).SetBytes(trimMPInt(nBytes)),
				E: int(new(big.Int).SetBytes(trimMPInt(eBytes)).Int64()),
			},
			D:      new(big.Int).SetBytes(trimMPInt(dBytes)),
			Primes: []*big.Int{new(big.Int).SetBytes(trimMPInt(pBytes)), new(big.Int).SetBytes(trimMPInt(qBytes))},
		}
		priv.Precompute()
		return priv, "rsa", comment, nil

	default:
		return nil, "", "", fmt.Errorf("unsupported PuTTY key algorithm %q", algo)
	}
}

func derivePPKv2Keys(passphrase string) (cipherKey, iv, macKey []byte) {
	var b1, b2 [4]byte
	binary.BigEndian.PutUint32(b1[:], 0)
	binary.BigEndian.PutUint32(b2[:], 1)

	h1 := sha1.New()
	_, _ = h1.Write(b1[:])
	_, _ = h1.Write([]byte(passphrase))
	s1 := h1.Sum(nil)

	h2 := sha1.New()
	_, _ = h2.Write(b2[:])
	_, _ = h2.Write([]byte(passphrase))
	s2 := h2.Sum(nil)

	cipherKey = append(s1, s2[:12]...)
	iv = make([]byte, aes.BlockSize)

	hm := sha1.New()
	_, _ = hm.Write([]byte("putty-private-key-file-mac-key"))
	_, _ = hm.Write([]byte(passphrase))
	macKey = hm.Sum(nil)
	return cipherKey, iv, macKey
}

func derivePPKv3Keys(passphrase string, headers map[string]string) (cipherKey, iv, macKey []byte, err error) {
	saltHex := headers["Argon2-Salt"]
	salt, err := hex.DecodeString(saltHex)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("decode ppk Argon2-Salt: %w", err)
	}
	var memory uint32 = 8192
	var passes uint32 = 13
	var parallel uint8 = 1
	_, _ = fmt.Sscanf(headers["Argon2-Memory"], "%d", &memory)
	_, _ = fmt.Sscanf(headers["Argon2-Passes"], "%d", &passes)
	_, _ = fmt.Sscanf(headers["Argon2-Parallelism"], "%d", &parallel)

	// 32 bytes cipher key + 16 bytes IV + 32 bytes MAC key = 80 bytes
	derived := argon2.IDKey([]byte(passphrase), salt, passes, memory, parallel, 80)
	return derived[:32], derived[32:48], derived[48:80], nil
}

func buildPPKMacData(algo, encryption, comment string, pubBlob, privBlob []byte) []byte {
	var buf bytes.Buffer
	writeSSHString(&buf, []byte(algo))
	writeSSHString(&buf, []byte(encryption))
	writeSSHString(&buf, []byte(comment))
	writeSSHString(&buf, pubBlob)
	writeSSHString(&buf, privBlob)
	return buf.Bytes()
}

func writeSSHString(buf *bytes.Buffer, b []byte) {
	var lenBytes [4]byte
	binary.BigEndian.PutUint32(lenBytes[:], uint32(len(b)))
	_, _ = buf.Write(lenBytes[:])
	_, _ = buf.Write(b)
}

func readSSHString(r *bytes.Reader) ([]byte, error) {
	var lenBytes [4]byte
	if _, err := r.Read(lenBytes[:]); err != nil {
		return nil, err
	}
	n := binary.BigEndian.Uint32(lenBytes[:])
	if n > uint32(r.Len()) {
		return nil, errors.New("ssh string length exceeds buffer")
	}
	out := make([]byte, n)
	if _, err := r.Read(out); err != nil {
		return nil, err
	}
	return out, nil
}

func trimMPInt(b []byte) []byte {
	for len(b) > 1 && b[0] == 0 {
		b = b[1:]
	}
	return b
}

