package preferences

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// passcodeRounds is the PBKDF2 cost of a passcode hash.
const passcodeRounds = 210_000

// PasscodeMinLength is the shortest passcode the lock takes.
const PasscodeMinLength = 4

// ErrPasscodeShort rejects a passcode under PasscodeMinLength.
var ErrPasscodeShort = errors.New("preferences: the passcode is too short")

// HashPasscode returns the salted hash the preferences keep for a
// passcode: "pbkdf2-sha256$<rounds>$<salt>$<key>".
func HashPasscode(passcode string) (string, error) {
	if len([]rune(passcode)) < PasscodeMinLength {
		return "", ErrPasscodeShort
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := pbkdf2.Key(sha256.New, passcode, salt, passcodeRounds, 32)
	if err != nil {
		return "", err
	}
	enc := base64.RawStdEncoding
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s", passcodeRounds, enc.EncodeToString(salt), enc.EncodeToString(key)), nil
}

// CheckPasscode tells whether passcode matches a hash from HashPasscode.
func CheckPasscode(hash, passcode string) bool {
	parts := strings.Split(hash, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	rounds, err := strconv.Atoi(parts[1])
	enc := base64.RawStdEncoding
	salt, err1 := enc.DecodeString(parts[2])
	want, err2 := enc.DecodeString(parts[3])
	if err != nil || err1 != nil || err2 != nil || rounds <= 0 {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, passcode, salt, rounds, len(want))
	return err == nil && subtle.ConstantTimeCompare(got, want) == 1
}
