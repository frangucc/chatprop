so we have a system that tries to spot tickers on the fly as comments come in fresh on discord. Sometimes, we pass just the message, and ask Anthropic to guess if it's a proper ticker or not. 

Then, over time, as more discord messages are saved, for that ticker, we get a little more context, and can try to correct the actual mentions count on a real ticker, by passing more context. 

Should we and could we create a background job, that for each ticker, runs a larger window of messages when there is a higher count of total messages, to see if we need to update the actual mentions count? 

