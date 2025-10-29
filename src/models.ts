/**
 * Shared type definitions for the Discord bot
 */

export interface LorebookEntry {
  name: string;
  keys: string[];
  content: string;
  enabled: boolean;
  insertion_order: number;
  case_sensitive: boolean;
  priority: number;
  id: number;
  comment: string;
  selective: boolean;
  constant: boolean;
  position: string;
  extensions?: Record<string, any>;
  probability?: number;
  selectiveLogic?: number;
  secondary_keys?: string[];
}

export interface CharacterBook {
  name: string;
  description: string;
  scan_depth: number;
  token_budget: number;
  recursive_scanning: boolean;
  extensions: Record<string, any>;
  entries: LorebookEntry[];
}

export interface DepthPrompt {
  depth: number;
  prompt: string;
  role?: string;
}

export interface Character {
  name: string;
  description: string;
  mesExample: string;
  depthPrompt: DepthPrompt | null;
  character_book: CharacterBook | null;
}

export interface CharacterCardV2 {
  spec: string;
  spec_version: string;
  data: {
    name: string;
    description: string;
    personality?: string;
    first_mes?: string;
    mes_example?: string;
    scenario?: string;
    creator_notes?: string;
    system_prompt?: string;
    post_history_instructions?: string;
    alternate_greetings?: string[];
    tags?: string[];
    creator?: string;
    character_version?: string;
    extensions?: {
      depth_prompt?: DepthPrompt;
      [key: string]: any;
    };
    character_book?: CharacterBook;
    [key: string]: any;
  };
}

export interface Message {
  id: string;
  chatId?: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: Date;
  parentId?: string | null;
  variantIndex?: number;
}

export interface AIRequestBody {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  temperature: number;
  character: string;
}
