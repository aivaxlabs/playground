------
title: Fix multiple thinking blocks
created-at: 02/04/2026, 15:49:48
order: 3
author: CypherPotato
------
A visual bug is causing several reasoning processes to be split between one block and another.

For example: the model starts a thinking tag in <think> or sends reasoning tokens via the delta's "reasoning" parameter, and at some point it calls a tool or sends an empty content token. At that moment, another thinking block is started in the frontend.

When the model continues "thinking", even after an empty iteration (no visual chunk or tool), it should stay in the previous thinking block.