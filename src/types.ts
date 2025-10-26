/**
 * Character Book Entry Type
 */
export interface CharacterBookEntry {
  uid?: number;
  keys: string[];
  content: string;
  extensions?: Record<string, any>;
  enabled: boolean;
  insertion_order?: number;
  case_sensitive?: boolean;
  name?: string;
  priority?: number;
  id?: number;
  comment?: string;
  selective?: boolean;
  secondary_keys?: string[];
  constant?: boolean;
  position?: number | string; // Can be number or string like "before_char"
  order?: number;
  disable?: boolean;
  excludeRecursion?: boolean;
  preventRecursion?: boolean;
  delayUntilRecursion?: boolean;
  probability?: number;
  useProbability?: boolean;
  depth?: number;
  selectiveLogic?: number;
  scanDepth?: number | null;
  keysecondary?: string[];
}

/**
 * Character Book Type
 */
export interface CharacterBook {
  id?: string; // Database ID (only present when fetched from API)
  name?: string | null;
  description?: string | null;
  scanDepth?: number | null;
  tokenBudget?: number | null;
  recursiveScanning?: boolean | null;
  extensions?: Record<string, any> | null;
  entries: CharacterBookEntry[] | null;
  visibility?: string; // 'public', 'hidden', 'private'
}

/**
 * Character Book Data (full database record)
 * Also supports snake_case for import/export compatibility
 */
export interface CharacterBookData {
  id?: string;
  creatorId?: string;
  name: string;
  description: string | null;
  scanDepth?: number | null;
  tokenBudget?: number | null;
  recursiveScanning?: boolean | null;
  // Snake case alternatives for import/export
  scan_depth?: number | null;
  token_budget?: number | null;
  recursive_scanning?: boolean | null;
  extensions: Record<string, any>;
  entries: CharacterBookEntry[];
  visibility?: string;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}