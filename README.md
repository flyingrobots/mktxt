# mktxt

A simple tool to aggregate all non-binary files in a directory into a single text file.

## Usage

Run the script from the directory you want to aggregate:

```bash
./mktxt
```

The output will be saved to `mktxt_aggregate.txt`.

## Features

- Recursively traverses the current directory.
- Respects `.gitignore` by using `git ls-files` when inside a Git repository.
- Excludes binary files automatically.
- Formats each file with its relative path as a header.
