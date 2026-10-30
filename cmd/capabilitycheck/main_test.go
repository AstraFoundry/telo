package main

import "testing"

func TestMatrixResolves(t *testing.T) {
	fails, err := Check("../..")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range fails {
		t.Error(f)
	}
}
