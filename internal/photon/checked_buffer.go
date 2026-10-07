package photon

import (
	"bytes"
	"errors"
)

// decodeBuffer keeps the legacy tolerant helpers usable by callers while the
// exported message decoders track every failed read and reject partial values.
type decodeBuffer interface {
	Read([]byte) (int, error)
	ReadByte() (byte, error)
	Next(int) []byte
	Len() int
}

type checkedBuffer struct {
	*bytes.Buffer
	err   error
	depth int
}

func (b *checkedBuffer) fail(reason string) {
	if b.err == nil {
		b.err = errors.New(reason)
	}
}

func decodeFailure(buf decodeBuffer, reason string) {
	if checked, ok := buf.(*checkedBuffer); ok {
		checked.fail(reason)
	}
}

func (b *checkedBuffer) Read(data []byte) (int, error) {
	n, err := b.Buffer.Read(data)
	if n < len(data) {
		b.fail("truncated parameter value")
	}
	return n, err
}

func (b *checkedBuffer) ReadByte() (byte, error) {
	value, err := b.Buffer.ReadByte()
	if err != nil {
		b.fail("truncated parameter value")
	}
	return value, err
}

func (b *checkedBuffer) Next(count int) []byte {
	data := b.Buffer.Next(count)
	if len(data) < count {
		b.fail("truncated parameter value")
	}
	return data
}
