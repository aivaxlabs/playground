------
title: Add stop button
created-at: 29/01/2026, 20:57:32
author: CypherPotato
tags: bug
original-category: Backlog
------

# Add Stop Button

Implement a stop/cancel button that allows users to interrupt the model inference process. The button should be displayed while a response is being generated, and the application should properly detect and handle the interruption when the Server-Sent Events (SSE) stream is terminated by the user.