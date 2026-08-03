package executor

import (
	"bufio"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"math/bits"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
)

type instructionRecord struct {
	Instruction string `json:"instruction"`
	Input       string `json:"input"`
	Output      string `json:"output"`
}

type inspectedRecord struct {
	record instructionRecord
	hash   string
	tokens int
	sim    uint64
}

func inspectDataset(payload map[string]any, dataRoot, outputRoot string) (map[string]any, error) {
	reference := stringValue(payload, "source_ref")
	if stringValue(payload, "dataset_id") == "" || reference == "" {
		return nil, fmt.Errorf("数据检查任务缺少数据版本或文件引用")
	}
	sourcePath, err := safeJoin(dataRoot, reference)
	if err != nil {
		return nil, err
	}
	return inspectDatasetFile(payload, sourcePath, outputRoot)
}

func inspectDatasetFile(payload map[string]any, sourcePath, outputRoot string) (map[string]any, error) {
	datasetID := stringValue(payload, "dataset_id")
	format := stringValue(payload, "format")
	mapping := stringMap(payload["mapping"])
	records, rows, invalid, empty, err := readRecords(sourcePath, format, mapping)
	if err != nil {
		return nil, err
	}
	if len(records) < 3 {
		return nil, fmt.Errorf("有效且不重复的数据不足 3 条，无法建立训练、验证和测试集")
	}

	unique := make([]inspectedRecord, 0, len(records))
	seen := make(map[string]struct{}, len(records))
	duplicates := 0
	for _, record := range records {
		normalized := normalizeRecord(record)
		digest := sha256.Sum256([]byte(normalized))
		hash := hex.EncodeToString(digest[:])
		if _, exists := seen[hash]; exists {
			duplicates++
			continue
		}
		seen[hash] = struct{}{}
		unique = append(unique, inspectedRecord{
			record: record,
			hash:   hash,
			tokens: estimateTokens(record),
			sim:    simhash(normalized),
		})
	}
	if len(unique) < 3 {
		return nil, fmt.Errorf("去除重复项后数据不足 3 条，无法安全切分")
	}
	similar := countSimilar(unique, 5000)
	sort.Slice(unique, func(i, j int) bool { return unique[i].hash < unique[j].hash })

	split := intMap(payload["split"])
	trainEnd := len(unique) * split["train"] / 100
	validationEnd := trainEnd + len(unique)*split["validation"]/100
	if trainEnd < 1 {
		trainEnd = 1
	}
	if validationEnd <= trainEnd {
		validationEnd = trainEnd + 1
	}
	if validationEnd >= len(unique) {
		validationEnd = len(unique) - 1
	}

	datasetDirectory := filepath.Join(outputRoot, "llmweb", "datasets", datasetID)
	if err := os.MkdirAll(datasetDirectory, 0o750); err != nil {
		return nil, fmt.Errorf("创建本地数据版本目录: %w", err)
	}
	if err := writeRecords(filepath.Join(datasetDirectory, "train.json"), unique[:trainEnd]); err != nil {
		return nil, err
	}
	if err := writeRecords(filepath.Join(datasetDirectory, "validation.json"), unique[trainEnd:validationEnd]); err != nil {
		return nil, err
	}
	if err := writeRecords(filepath.Join(datasetDirectory, "test.json"), unique[validationEnd:]); err != nil {
		return nil, err
	}
	datasetInfo := map[string]any{}
	for _, name := range []string{"train", "validation", "test"} {
		datasetInfo["llmweb_"+name] = map[string]any{
			"file_name": name + ".json",
			"columns":   map[string]string{"prompt": "instruction", "query": "input", "response": "output"},
		}
	}
	if err := writeJSON(filepath.Join(datasetDirectory, "dataset_info.json"), datasetInfo); err != nil {
		return nil, err
	}

	tokenLengths := make([]int, len(unique))
	versionHasher := sha256.New()
	for index, item := range unique {
		tokenLengths[index] = item.tokens
		versionHasher.Write([]byte(item.hash))
	}
	sort.Ints(tokenLengths)
	statistics := map[string]any{
		"rows":               rows,
		"valid_rows":         len(unique),
		"invalid_rows":       invalid,
		"empty_rows":         empty,
		"duplicates":         duplicates,
		"similar_duplicates": similar,
		"token_length": map[string]int{
			"p50": tokenLengths[len(tokenLengths)/2],
			"p95": tokenLengths[(len(tokenLengths)-1)*95/100],
			"max": tokenLengths[len(tokenLengths)-1],
		},
		"splits":  map[string]int{"train": trainEnd, "validation": validationEnd - trainEnd, "test": len(unique) - validationEnd},
		"leakage": map[string]int{"exact_matches": 0},
	}
	result := map[string]any{
		"version_hash": "sha256:" + hex.EncodeToString(versionHasher.Sum(nil)),
		"statistics":   statistics,
	}
	if boolValue(payload, "preview_allowed") {
		previewSize := 3
		if len(unique) < previewSize {
			previewSize = len(unique)
		}
		preview := make([]instructionRecord, previewSize)
		for index := 0; index < previewSize; index++ {
			preview[index] = unique[index].record
		}
		result["preview"] = preview
	}
	return result, nil
}

func readRecords(path, format string, mapping map[string]string) ([]instructionRecord, int, int, int, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, 0, 0, 0, fmt.Errorf("读取本地数据文件 %q: %w", filepath.Base(path), err)
	}
	defer file.Close()
	records := make([]instructionRecord, 0)
	rows, invalid, empty := 0, 0, 0
	consume := func(item map[string]any) {
		rows++
		record := instructionRecord{
			Instruction: fmt.Sprint(item[mapping["instruction"]]),
			Input:       fmt.Sprint(item[mapping["input"]]),
			Output:      fmt.Sprint(item[mapping["output"]]),
		}
		if record.Instruction == "<nil>" {
			record.Instruction = ""
		}
		if record.Input == "<nil>" {
			record.Input = ""
		}
		if record.Output == "<nil>" {
			record.Output = ""
		}
		record.Instruction = strings.TrimSpace(record.Instruction)
		record.Input = strings.TrimSpace(record.Input)
		record.Output = strings.TrimSpace(record.Output)
		if record.Instruction == "" || record.Output == "" {
			empty++
			return
		}
		records = append(records, record)
	}

	switch format {
	case "json":
		var items []map[string]any
		if err := json.NewDecoder(file).Decode(&items); err != nil {
			return nil, 0, 0, 0, fmt.Errorf("JSON 格式无效: %w", err)
		}
		for _, item := range items {
			consume(item)
		}
	case "jsonl":
		scanner := bufio.NewScanner(file)
		scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
		for scanner.Scan() {
			if strings.TrimSpace(scanner.Text()) == "" {
				continue
			}
			var item map[string]any
			if err := json.Unmarshal(scanner.Bytes(), &item); err != nil {
				rows++
				invalid++
				continue
			}
			consume(item)
		}
		if err := scanner.Err(); err != nil {
			return nil, 0, 0, 0, fmt.Errorf("读取 JSONL: %w", err)
		}
	case "csv":
		reader := csv.NewReader(file)
		headers, err := reader.Read()
		if err != nil {
			return nil, 0, 0, 0, fmt.Errorf("读取 CSV 表头: %w", err)
		}
		for {
			values, err := reader.Read()
			if err != nil {
				if err.Error() == "EOF" {
					break
				}
				rows++
				invalid++
				continue
			}
			item := make(map[string]any, len(headers))
			for index, header := range headers {
				if index < len(values) {
					item[header] = values[index]
				}
			}
			consume(item)
		}
	default:
		return nil, 0, 0, 0, fmt.Errorf("不支持的数据格式 %q", format)
	}
	return records, rows, invalid, empty, nil
}

func safeJoin(root, relative string) (string, error) {
	if filepath.IsAbs(relative) {
		return "", fmt.Errorf("数据文件必须位于已授权的数据目录内")
	}
	clean := filepath.Clean(relative)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("数据文件引用超出了已授权的数据目录")
	}
	joined := filepath.Join(root, clean)
	rel, err := filepath.Rel(root, joined)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("数据文件引用超出了已授权的数据目录")
	}
	return joined, nil
}

func normalizeRecord(record instructionRecord) string {
	return strings.Join([]string{normalizeText(record.Instruction), normalizeText(record.Input), normalizeText(record.Output)}, "\n")
}

func normalizeText(value string) string {
	return strings.ToLower(strings.Join(strings.Fields(value), " "))
}

func estimateTokens(record instructionRecord) int {
	length := len([]rune(record.Instruction + record.Input + record.Output))
	return length/3 + 1
}

func simhash(value string) uint64 {
	runes := []rune(strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return unicode.ToLower(r)
	}, value))
	weights := [64]int{}
	if len(runes) < 3 {
		runes = append(runes, '_', '_')
	}
	for index := 0; index+3 <= len(runes); index++ {
		hasher := fnv.New64a()
		_, _ = hasher.Write([]byte(string(runes[index : index+3])))
		hash := hasher.Sum64()
		for bit := 0; bit < 64; bit++ {
			if hash&(uint64(1)<<bit) != 0 {
				weights[bit]++
			} else {
				weights[bit]--
			}
		}
	}
	var result uint64
	for bit, weight := range weights {
		if weight >= 0 {
			result |= uint64(1) << bit
		}
	}
	return result
}

func countSimilar(records []inspectedRecord, limit int) int {
	length := len(records)
	if length > limit {
		length = limit
	}
	count := 0
	for left := 0; left < length; left++ {
		for right := left + 1; right < length; right++ {
			if bits.OnesCount64(records[left].sim^records[right].sim) <= 3 {
				count++
			}
		}
	}
	return count
}

func writeRecords(path string, items []inspectedRecord) error {
	records := make([]instructionRecord, len(items))
	for index, item := range items {
		records[index] = item.record
	}
	return writeJSON(path, records)
}

func writeJSON(path string, value any) error {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("生成本地数据版本: %w", err)
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, payload, 0o640); err != nil {
		return fmt.Errorf("写入本地数据版本: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		return fmt.Errorf("保存本地数据版本: %w", err)
	}
	return nil
}

func stringValue(payload map[string]any, key string) string {
	value, _ := payload[key].(string)
	return value
}

func boolValue(payload map[string]any, key string) bool {
	value, _ := payload[key].(bool)
	return value
}

func stringMap(value any) map[string]string {
	result := map[string]string{"instruction": "instruction", "input": "input", "output": "output"}
	if source, ok := value.(map[string]any); ok {
		for key, item := range source {
			if stringItem, valid := item.(string); valid {
				result[key] = stringItem
			}
		}
	}
	return result
}

func intMap(value any) map[string]int {
	result := map[string]int{"train": 80, "validation": 10, "test": 10}
	if source, ok := value.(map[string]any); ok {
		for key, item := range source {
			if number, valid := item.(float64); valid {
				result[key] = int(number)
			}
		}
	}
	return result
}
