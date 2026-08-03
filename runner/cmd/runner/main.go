package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"llmweb/runner/internal/capabilities"
)

const version = "0.1.0"

func main() {
	if len(os.Args) != 2 {
		printUsage()
		os.Exit(2)
	}

	switch os.Args[1] {
	case "doctor":
		runDoctor()
	case "version":
		fmt.Println(version)
	default:
		printUsage()
		os.Exit(2)
	}
}

func runDoctor() {
	report := capabilities.Probe(context.Background())
	payload := struct {
		capabilities.Report
		Ready bool `json:"ready"`
	}{Report: report, Ready: report.Ready()}

	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(payload); err != nil {
		fmt.Fprintf(os.Stderr, "encode capability report: %v\n", err)
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Fprintln(os.Stderr, "usage: llmweb-runner <doctor|version>")
}
