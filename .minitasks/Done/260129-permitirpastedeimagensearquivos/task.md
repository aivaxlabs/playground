------
title: Support pasting images and files in chat input
created-at: 29/01/2026, 22:35:12
author: CypherPotato
tags: feature, user-experience, file-handling
------

# Support pasting images and files in chat input

## What is this?

This feature enables users to attach images and files directly to the chat by pasting them into the message input field. Currently, the chat input may not handle clipboard paste events for media files or documents, limiting the user's ability to quickly share files without using a dedicated upload button.

By implementing paste functionality, users will have a more intuitive and faster way to attach content to their messages, improving the overall user experience.

## Implementation

To implement this feature, you should:

1. **Listen to paste events**: Add an event listener to the chat input field that captures `paste` events from the clipboard.

2. **Extract file data**: Access the `DataTransfer` object from the clipboard event to retrieve files and media items.

3. **Validate files**: Check file types and sizes to ensure they meet application requirements.

4. **Display previews**: Show visual previews of images or file indicators in the chat input before sending.

5. **Handle submission**: Ensure files are properly sent to the server along with the message text when the user submits.