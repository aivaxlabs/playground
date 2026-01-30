------
title: Fix interleaved reasoning tokens display in chat
created-at: 29/01/2026, 20:56:28
author: CypherPotato
tags: bug
original-category: Backlog
------

# Fix Interleaved Reasoning Tokens Display

## Problem

Currently, special tokens (like reasoning tokens) are always displayed at the top of the chat. However, models that perform "thinking while speaking" (such as Claude models) emit tokens in an interleaved format:

```
<thinking>
reasoning step 1
</thinking>
response content 1
<thinking>
reasoning step 2
</thinking>
response content 2
```

But in the chat UI, these are currently being concatenated incorrectly, resulting in:

```
<thinking>reasoning step 1reasoning step 2</thinking>
response content 1response content 2
```

This makes the chat confusing and hard to follow.

## Solution

Adapt the chat display logic to correctly handle and render interleaved reasoning tokens, preserving the proper order and separation of reasoning blocks and response content.