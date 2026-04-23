export const FORM_LABELS: Record<string, string> = {
  bias: "Cognitive bias",
  fallacy: "Fallacy",
  paradox: "Paradox",
  thought_experiment: "Thought experiment",
  effect: "Named effect",
  heuristic: "Heuristic",
  phenomenon: "Phenomenon",
  concept: "Concept",
  principle: "Principle",
  misconception: "Misconception",
  law: "Law",
  hypothesis: "Hypothesis",
};

export const DOMAIN_LABELS: Record<string, string> = {
  cognitive_science: "Cognitive science",
  psychology: "Psychology",
  philosophy: "Philosophy",
  logic: "Logic",
  mathematics: "Mathematics",
  physics: "Physics",
  biology: "Biology",
  economics: "Economics",
  linguistics: "Linguistics",
  sociology: "Sociology",
  computer_science: "Computer science",
  decision_theory: "Decision theory",
  perception: "Perception",
  ethics: "Ethics",
  other: "Other",
};

export const AFFECT_LABELS: Record<string, string> = {
  mind_bending: "Mind-bending",
  practical: "Practical",
  unsettling: "Unsettling",
  wholesome: "Wholesome",
  melancholic: "Melancholic",
  existential: "Existential",
  funny: "Funny",
  sobering: "Sobering",
  neutral: "Neutral",
};

export const SOURCE_LABELS: Record<string, string> = {
  cognitive_biases: "Cognitive biases",
  fallacies: "Fallacies",
  paradoxes: "Paradoxes",
  thought_experiments: "Thought experiments",
  effects: "Named effects",
};

export function label(kind: "form" | "domain" | "affect" | "source", value: string): string {
  switch (kind) {
    case "form":
      return FORM_LABELS[value] ?? value;
    case "domain":
      return DOMAIN_LABELS[value] ?? value;
    case "affect":
      return AFFECT_LABELS[value] ?? value;
    case "source":
      return SOURCE_LABELS[value] ?? value;
  }
}
