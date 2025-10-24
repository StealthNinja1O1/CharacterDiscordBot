const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_BASE_URL = process.env.LLM_BASE_URL;

// OpenAI-compatible API types
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
      role: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export async function generateResponse(model: string, messages: ChatMessage[], temperature: number): Promise<string> {
  if (!LLM_API_KEY) throw new Error("LLM API key (LLM_API_KEY) is not configured in .env file");
  if (!LLM_BASE_URL) throw new Error("LLM base URL (LLM_BASE_URL) is not configured in .env file");
  

  const requestBody: ChatCompletionRequest = {
    model,
    messages,
    temperature,
  };

  try {
    const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API request failed: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;

    if (!data.choices || data.choices.length === 0) {
      throw new Error("No response from LLM API");
    }

    return data.choices[0].message.content;
  } catch (error) {
    console.error("Error calling LLM API:", error);
    throw error;
  }
}
