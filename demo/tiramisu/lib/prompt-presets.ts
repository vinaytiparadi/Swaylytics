// Copied from ../chat_v2/frontend/lib/prompt-presets.ts — keep in sync
export interface PromptPreset {
  id: string;
  label: string;
  description: string;
  prompt: string;
}

export const DEFAULT_SYSTEM_PROMPT = "";

export const DATA_ANALYSIS_PROMPT_PRESETS: PromptPreset[] = [
  {
    id: "eda",
    label: "Exploratory Analysis",
    description: "Quickly inspect data quality, distributions, missing values, and anomalies.",
    prompt: "Please perform exploratory data analysis on the current dataset. Start with schema and data quality, then summarize distributions, anomalies, correlations, and recommended next steps.",
  },
  {
    id: "cleaning",
    label: "Data Cleaning",
    description: "Detect missing values, duplicates, type issues, and outliers, then propose a cleaning plan.",
    prompt: "Please inspect the current data for missing values, duplicates, data type issues, and outliers. Provide a cleaning strategy and generate runnable cleaning code when helpful.",
  },
  {
    id: "viz",
    label: "Visualization Report",
    description: "Create presentation-ready charts with concise interpretation.",
    prompt: "Please generate a set of presentation-ready visualizations for the current data, highlight key trends, comparisons, and anomalies, and explain the business meaning of each chart.",
  },
  {
    id: "stats",
    label: "Statistical Testing",
    description: "Compare groups, explain significance, and interpret practical impact.",
    prompt: "Please design appropriate statistical tests for the current data, explain the hypotheses and method selection, and interpret significance and business implications.",
  },
  {
    id: "sql",
    label: "SQL Analysis",
    description: "Analyze SQLite tables and generate query-driven insights.",
    prompt: "Please analyze the current database or table structure with SQL. Propose a query plan, provide the SQL statements step by step, and explain the results and visual follow-up ideas.",
  },
  {
    id: "feature",
    label: "Feature Review",
    description: "Assess feature quality, target candidates, and modeling readiness.",
    prompt: "Please review the current data from a modeling-preparation perspective. Identify candidate targets, important features, feature quality issues, and recommended next modeling steps.",
  },
  {
    id: "report",
    label: "Executive Summary",
    description: "Turn the analysis into a concise report summary for stakeholders.",
    prompt: "Please summarize the current analysis into an executive-ready report that includes key findings, supporting evidence, risks, and recommended next actions.",
  },
];
