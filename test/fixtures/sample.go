package main

import "fmt"

import (
	"os"
	"github.com/user/pkg"
)

func main() {
	helper()
}

func helper() {
	fmt.Println(os.Getenv("HOME"))
	pkg.Do()
}
