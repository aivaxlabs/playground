------
title: Visual bug on input
created-at: 02/04/2026, 15:51:31
order: 4
author: CypherPotato
------
A reactivity bug:
- you type something in the input to send to the model;
- you open the model settings, sampling or something else;
- you save – what you typed before is lost.

Possible solution:
- while I type, I save the content in `onInput(event) { valueInput.value = event.target.value; }`, and when rendering the component, I load `valueInput.value` as the initial text.