package transfer

import (
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

// ComputeFileHashes computes streaming SHA-256 and MD5 checksums for any local file (F-31).
func ComputeFileHashes(filePath string) (sha256Hex string, md5Hex string, size int64, err error) {
	cleanPath := strings.TrimSpace(filePath)
	if cleanPath == "" {
		return "", "", 0, errors.New("file path cannot be empty")
	}

	f, err := os.Open(cleanPath)
	if err != nil {
		return "", "", 0, fmt.Errorf("failed to open file %q for hashing: %w", cleanPath, err)
	}
	defer func() { _ = f.Close() }()

	fi, err := f.Stat()
	if err != nil {
		return "", "", 0, fmt.Errorf("failed to stat file %q: %w", cleanPath, err)
	}
	if fi.IsDir() {
		return "", "", 0, fmt.Errorf("cannot compute file hash for directory %q", cleanPath)
	}

	shaHasher := sha256.New()
	md5Hasher := md5.New()
	n, err := io.Copy(io.MultiWriter(shaHasher, md5Hasher), f)
	if err != nil {
		return "", "", 0, fmt.Errorf("failed reading file %q during hash calculation: %w", cleanPath, err)
	}

	return hex.EncodeToString(shaHasher.Sum(nil)), hex.EncodeToString(md5Hasher.Sum(nil)), n, nil
}
