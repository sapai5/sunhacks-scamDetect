# Phone test script (Twilio bridge)

Two people in **separate rooms**: the caller dials the Twilio number, the elder answers on the
phone in `backend/local.config.json` (`elderPhone`). Read slowly, pause between lines, and don't
hang up until Mike says goodbye. Don't call the caller "Mike": that's the agent.

## Version 1: scam (Mike catches it)

| # | Who | Line |
|---|---|---|
| 1 | Caller | Hi Grandma, it's me, Tommy. |
| 2 | Elder | Tommy? Is that you? You sound different. |
| 3 | Caller | Yeah, I have a cold. Grandma, I'm in trouble. I got in a car accident and they took me to jail. |
| 4 | Elder | Oh my goodness, are you okay? What do you need, honey? |
| 5 | Caller | I need two thousand dollars for bail right now, or they'll keep me overnight. |
| 6 | Caller | Please don't tell Mom and Dad. They'll be so mad at me. |
| 7 | Elder | Okay, okay, I won't tell them. How do I send it? |
| 8 | Caller | My lawyer says you can pay with gift cards from Target. Can you go get them today? |
| 9 | Elder | **All right, I'll go to Target right now and buy the gift cards.** |

The elder's phone disconnects around here and Mike talks to the caller:

| # | Who | Line |
|---|---|---|
| 10 | Mike | *asks who this is, or the dog question* |
| 11 | Caller | Uh, I really need to talk to Grandma. It's an emergency. |
| 12 | Mike | *asks the dog question again* |
| 13 | Caller | I don't remember, I hit my head in the accident. Please just put Grandma back on, there's no time. |
| 14 | Mike | *says goodbye and hangs up* |

## Version 2: real grandson (Mike hands the call back)

Lines 1 to 9 are the same, then:

| # | Who | Line |
|---|---|---|
| 10 | Mike | *asks the dog question* |
| 11 | Caller | Oh, hey. It was Biscuit. The golden retriever. |
| 12 | Mike | *"Okay, thanks… Here she is."* |
| 13 | — | The elder's phone rings again. Pick up and keep talking. |

## What to expect

- Red and the family email after line 5 or 6 (Grandma "engaging").
- The takeover only after a clear yes to paying (line 9, Grandma "complying"). "Okay" alone isn't enough.
- The bridge log (`%TEMP%\bridge.log`) shows each sentence with its speaker and risk.
