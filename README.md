# mktxt

A simple tool to aggregate all non-binary files in a directory into a single text file.

## Usage

Run the script from the directory you want to aggregate, or specify a target directory and filter:

```bash
./mktxt [--cwd=<path>] [filter="<pattern>"]
```

Example:
```bash
./mktxt --cwd=./src filter="*.ts"
```

The output will be saved to `mktxt_aggregate.txt` in the directory where you *invoked* the script.

## Features

- Recursively traverses the current or specified directory (`--cwd`).
- Filter files by glob pattern (`filter="*.ext"`).
- Respects `.gitignore` by using `git ls-files` when inside a Git repository.
- Excludes binary and empty files automatically.
- Formats each file with its relative path as a header.
