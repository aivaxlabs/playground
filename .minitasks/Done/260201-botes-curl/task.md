------
title: Export and Import cURL Commands
created-at: 01/02/2026, 23:02:21
author: CypherPotato
tags: feature, ui, export, import, curl, api
------

# Export and Import cURL Commands

## Overview

Add two new buttons to the chat UI that enable users to export and import API requests as cURL commands. This will facilitate debugging, sharing, and testing API calls outside the application.

## Features

### View Code Button (Export to cURL)

Generate a bash-compatible cURL command that replicates the current API request. The button should:
- Generate a properly formatted cURL command with the current request parameters
- Include an "Embed API Key" checkbox in the dialog to optionally include the API key in the command
- Format the output code with proper syntax highlighting and indentation
- Allow easy copying of the generated command

### Import cURL Button (Import from cURL)

Parse a cURL command and import its parameters into the chat application. The button should:
- Accept a cURL command as input
- Parse HTTP headers from the command
- Extract the API endpoint URL
- Parse the JSON body
- Import relevant fields such as:
  - Messages
  - Tools/functions
  - Model selection
  - Temperature and other parameters
  - System prompts

## Implementation Notes

- Ensure proper parsing of cURL commands with various formats (single-line, multi-line with backslashes)
- Handle both `-H` and `--header` syntax for headers
- Support `-d`, `--data`, and `--data-raw` for request body
- Validate JSON before importing
- Show user-friendly error messages for invalid cURL commands
- Consider using a cURL parser library if available