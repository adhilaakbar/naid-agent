"""Quick test: send one message to Claude and print the response."""
import os
from dotenv import load_dotenv
from anthropic import Anthropic

load_dotenv()

client = Anthropic()

response = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=200,
    messages=[
        {"role": "user", "content": "Say 'NAID agent setup works' and nothing else."}
    ],
)

print(response.content[0].text)