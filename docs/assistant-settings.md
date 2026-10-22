# Assistant studio: every option of a client's assistant

Admin, client, **Assistant studio** (`/admin/clients/<id>/assistant`). One card per section, each saved on its own:

| Section | What it sets |
| --- | --- |
| AI model | The language model (with what it costs us and what we keep), temperature, longest reply, thinking level, parallel tools, backup models |
| Voice | English and Arabic voice (search our ElevenLabs account or the public voice library, with sound samples), voice model per language, stability, similarity, speed, number reading, expressive mode, the voices the client may choose from |
| Conversation | How quickly it answers, wait times, hang up after silence, longest call, "one moment" phrase, the greeting in each language |
| Hearing | Speech recognition provider (Standard, or Scribe v2 Turbo), extra words to listen for (clinic and doctor names are added automatically) |
| Safety, privacy and limits | Topic guard, prompt-injection guard, record audio, conversations per day, simultaneous calls, bursting |
| Call analysis | Language of call summaries, which quality checks ElevenLabs runs |
| Website widget | Brand or custom colours, size, position, texts, which controls visitors get |

Below the sections: **Live in ElevenLabs** (reads the assistant back from ElevenLabs and sets each value beside what CallsDash saved), **What ElevenLabs charges us** (the two fees every cost starts from) and **Try the assistant** (the same test panel as the client page).

A custom greeting should still say the conversation is recorded. The page warns, under the greeting fields, when a saved greeting does not mention it (English: "record"; Arabic: any form of تسجيل / مسجلة). It is a warning only; leave a greeting blank to use the built-in one, which says it.

## How a save works

1. The form is checked (ranges, allowed choices, the model against ElevenLabs' own list).
2. The change is sent to the client's agent in ElevenLabs.
3. Only when ElevenLabs accepts the core settings (model, temperature, voices, voice models, longest call) is it stored in CallsDash. A refusal shows ElevenLabs' own words (kept on the server for a few minutes, never read from the address) and stores nothing, so a refused change is not saved on our side.
4. Optional groups (safety, analysis, widget, tuning) are sent as separate requests. If ElevenLabs refuses one, the assistant still works, the page names the group and says why, and the value stays saved here, so **Live in ElevenLabs** will show it as different until ElevenLabs accepts it.

Nothing keeps the two sides identical for ever: someone can edit the assistant inside ElevenLabs, or a request can fail half way. That is what **Live in ElevenLabs** is for. Its states are *Matches*, *Differs* (CallsDash sent a value and ElevenLabs shows another), *Not set* (that section was never saved, so ElevenLabs keeps its own value) and *Not used* (the chosen model never reads that setting, for example the temperature of a newer Claude or GPT model).

A client that has no assistant in ElevenLabs yet stores the choices; they are used when the assistant is created. The same happens when `ELEVENLABS_API_KEY` or the app address is missing: the page says "saved here, not sent yet".

A section's newer options reach ElevenLabs only after an admin saved that section once (the badge changes from "Defaults" to "Customised"). Clients that were never touched keep exactly the agent they had before. A saved section sends all its options (the Hearing section always sends its provider, "Standard" meaning Scribe Realtime), so **Back to defaults** really resets the assistant. The settings live in `AgentSettings.studio` (jsonb, no migration); `lib/agent-studio.ts` has the allowed values and limits.

## What it costs and what we keep

One credit is one voice minute or twenty chat messages. For a model, **our cost per minute** is ElevenLabs' own fee plus the model's share, and **we keep** is the share of the client's price left after that cost. The client's price is the cheapest of their active plans (a package's fee spread over its credits, or the pay-as-you-go credit price); green is 40% and up, amber 15% and up, red below.

- ElevenLabs' fee defaults to $0.08 per voice minute and $0.003 per chat message and is edited in **What ElevenLabs charges us**. The minute fee is from ElevenLabs' price list; the chat fee is a third-party figure, so compare with the first real invoice.
- The model's share comes from ElevenLabs' price calculator for the client's real instructions and knowledge base. It depends on how long that client's instructions are, so the answer is kept **per client** (read live, kept for ten minutes in memory, and the last good answer is saved in the database under that client). The model list itself is the same for everyone and is saved once. When the calculator cannot be reached the page says so and uses that client's last saved prices, or the built-in estimate from each model's price per million tokens (`lib/agent-catalog.ts`, marked with `*`) when there are none. One client's prices are never used for another.
- "A month of calls" uses the client's own last 30 days, or an example month (2,000 voice minutes, 8,000 messages) while there are fewer than five conversations.
- Dollars are shown in dinar at the pegged rate 0.377.

Each finished conversation is recorded with the same sums (`lib/costing.ts`): the minutes or messages times the client's model (using that client's saved prices) and the fees, so **Usage and margin** follows the model chosen here. These are estimates, not ElevenLabs' invoice. Conversations recorded without the sums (demo data) keep a flat estimate of $0.13 per minute and $0.005 per message.

## Voices

**Change voice** opens a search of the voices already in our ElevenLabs account (including cloned ones) or of the public library, filtered by language, gender and accent, with a sample to play. A library voice is copied into our account before it is used. "Verified for Arabic" appears when ElevenLabs lists the voice as verified for that language; nobody publishes which Arabic voices sound Gulf, so listen and use **Try the assistant** in Arabic before settling.

**Voice models.** ElevenLabs answered "400" when an assistant whose main language is English was given Flash v2.5 (seen on the first real sync, 2026-10-21), and accepted Flash v2. So the English side offers Flash v2 (the default), v3 Conversational and v4 Turbo; the last two have not been tried on a real English assistant yet, and a refusal is shown with ElevenLabs' words and stores nothing. The Arabic side offers Flash v2.5 (the default), Multilingual v2, v3 Conversational and v4 Turbo. Retired models (Turbo v2 and v2.5) and v4 (made for recorded audio, not for live calls) are hidden unless the assistant already uses them. **Expressive mode** follows the English model: it is only offered with v3 Conversational or v4 Turbo.

**Voices the client may choose from** is a list per language. The client sees it on their Voice page (name, gender, accent, sample); with an empty list they see the four built-in voices. Their current voice always stays selectable, and a voice that is not on the list is not accepted when they save.

Rachel, the default behind the built-in voices, is on ElevenLabs' list of older voices and ElevenLabs may swap it for another voice from the end of 2026. The screen says so and suggests picking a voice of your own.

## Not in the studio

ElevenLabs options that are undocumented or Enterprise only are left out on purpose: pronunciation dictionaries, audio effects and background sound, thinking budget, turn model, monitoring, redaction, zero retention. A phone number will also need the audio format `ulaw_8000` for the agent's output and input when it is connected (Twilio).

## Tests

`ELEVENLABS_API_BASE` points the app at a local fake ElevenLabs for tests and screenshots; in production it stays unset. The request shapes follow the ElevenLabs JavaScript SDK 2.74.0 and were not tested against the real service from the build environment. On the first real account check, in this order:

1. Open a client's Assistant studio. The model list should say "Live" and the prices "ElevenLabs' price".
2. Press **Save and apply** on the Voice section and open **Live in ElevenLabs**: every row should say "Matches".
3. Pick another model, save, and place a test call or chat through **Try the assistant**.
4. After the first invoice, compare it with **Usage and margin** and adjust the two fees.

If ElevenLabs refuses something, the page shows its message; send that text so the request can be corrected.
