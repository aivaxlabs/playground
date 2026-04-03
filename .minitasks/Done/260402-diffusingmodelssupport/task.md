------
title: Diffusing models support
created-at: 02/04/2026, 15:54:42
order: 6
author: CypherPotato
------
Add support for diffusion models.

On the settings page, add a “Diffusion Model” flag, which when enabled, instead of building a token‑by‑token string, each received chunk represents the partially built text. In this case, instead of accumulating content, clear the content and render the last received content.

Also, add a GET-importation query parameter `diffusion=true` to set this flag when importing an AI-model through query.