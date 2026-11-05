package ssh

import (
	"bytes"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
	"testing"

	gossh "golang.org/x/crypto/ssh"
)

func TestM1_3_GenerateAndImportOpenSSHandPuTTYPPK_F04(t *testing.T) {
	// 1. Generate Ed25519 keypair
	edKey, err := GenerateKeyPair("ops-ed25519", "ed25519", "")
	if err != nil {
		t.Fatalf("GenerateKeyPair ed25519: %v", err)
	}
	if edKey.Type != "ed25519" || !strings.HasPrefix(edKey.PublicKey, "ssh-ed25519 ") || !strings.HasPrefix(edKey.Fingerprint, "SHA256:") {
		t.Fatalf("unexpected generated ed25519 key record: %+v", edKey)
	}

	// 2. Generate RSA keypair with passphrase
	rsaKey, err := GenerateKeyPair("ops-rsa", "rsa", "KeyPass!123")
	if err != nil {
		t.Fatalf("GenerateKeyPair rsa: %v", err)
	}
	if rsaKey.Type != "rsa" || !strings.HasPrefix(rsaKey.PublicKey, "ssh-rsa ") || !strings.HasPrefix(rsaKey.Fingerprint, "SHA256:") {
		t.Fatalf("unexpected generated rsa key record: %+v", rsaKey)
	}

	// 3. Re-import OpenSSH PEM key with passphrase
	importedOpenSSH, err := ImportPrivateKey("reimported-rsa", rsaKey.PrivateKey, "KeyPass!123")
	if err != nil {
		t.Fatalf("ImportPrivateKey OpenSSH: %v", err)
	}
	if importedOpenSSH.Fingerprint != rsaKey.Fingerprint {
		t.Fatalf("fingerprint mismatch on OpenSSH import: got %s, want %s", importedOpenSSH.Fingerprint, rsaKey.Fingerprint)
	}

	// 4. Build a valid PuTTY .ppk v2 (ssh-ed25519, Encryption: none) and import it (F-04)
	pubRaw, privRaw, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("ed25519.GenerateKey: %v", err)
	}
	var pubBuf, privBuf bytes.Buffer
	writeSSHString(&pubBuf, []byte("ssh-ed25519"))
	writeSSHString(&pubBuf, pubRaw)
	writeSSHString(&privBuf, privRaw.Seed())

	macKeyHash := sha1.Sum([]byte("putty-private-key-file-mac-key"))
	macData := buildPPKMacData("ssh-ed25519", "none", "putty-ed25519-test", pubBuf.Bytes(), privBuf.Bytes())
	mac := hmac.New(sha1.New, macKeyHash[:])
	_, _ = mac.Write(macData)
	macHex := hex.EncodeToString(mac.Sum(nil))

	ppkContent := fmt.Sprintf(`PuTTY-User-Key-File-2: ssh-ed25519
Encryption: none
Comment: putty-ed25519-test
Public-Lines: 1
%s
Private-Lines: 1
%s
Private-MAC: %s
`, base64.StdEncoding.EncodeToString(pubBuf.Bytes()), base64.StdEncoding.EncodeToString(privBuf.Bytes()), macHex)

	importedPPK, err := ImportPrivateKey("", ppkContent, "")
	if err != nil {
		t.Fatalf("ImportPrivateKey PuTTY .ppk: %v", err)
	}
	sshPub, err := gossh.NewPublicKey(pubRaw)
	if err != nil {
		t.Fatalf("gossh.NewPublicKey: %v", err)
	}
	wantFP := gossh.FingerprintSHA256(sshPub)
	if importedPPK.Fingerprint != wantFP || importedPPK.Label != "putty-ed25519-test" {
		t.Fatalf("imported .ppk record mismatch: got %+v, want fingerprint %s", importedPPK, wantFP)
	}
}
