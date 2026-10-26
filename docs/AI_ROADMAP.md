# QuizPilot AI — Prioritized Roadmap for Future AI Features

## Priority 1 (Near-Term: Local & Privacy-Preserving Enhancements)

1. **In-Browser WebGPU / WebLLM Local Inference Provider (`WebLLMProvider`):**
   - Implement the `AIAnalysisProvider` interface using quantized in-browser models (e.g., Llama-3.2-1B-Instruct or Qwen-2.5-1.5B via WebGPU) so learners get rich natural-language explanations and distractor elimination 100% offline with zero external API calls.
2. **Local Vector Embeddings for Semantic Question Deduplication & Clustering:**
   - Replace lexical/topic-stem grouping in `groupSimilarQuestions()` with lightweight local sentence embeddings (`all-MiniLM-L6-v2` via ONNX Runtime Web) stored in `IndexedDB` to detect semantically equivalent practice questions phrased differently across mock exams.
3. **Automated Distractor Misconception Diagnosis:**
   - Analyze *which* specific incorrect option (`selectedResponse`) the learner chose and map it to the underlying conceptual misconception (e.g., confusing eventual consistency with causal consistency).

## Priority 2 (Mid-Term: Adaptive Learning & Retrieval-Augmented Verification)

4. **Local RAG over User-Supplied PDF/Markdown Lecture Notes (`RAGReferenceProvider`):**
   - Allow learners to import course textbooks, RFCs, or lecture slides into `IndexedDB`, chunking and indexing them locally so every AI-proposed answer cites the exact page and paragraph from the learner's approved course materials.
5. **FSRS (Free Spaced Repetition Scheduler) Integration:**
   - Upgrade the rule-based spaced-repetition intervals in `PersonalizedStudyPlan` to a full FSRS memory-stability model that adapts review intervals dynamically based on historical recall latency (`timeSpentMs`), confidence calibration, and repeat error rates.
6. **Synthetic Follow-Up Drill Generator:**
   - Automatically generate targeted isomorphic practice questions (single-choice, multi-choice, and fill-in-the-blank) focused specifically on the user's `High Priority` weak topics, complete with verified answer rationales.

## Priority 3 (Long-Term: Multimodal & Collaborative Study Workflows)

7. **Accessible Diagram & Architecture Schema Description (Vision-Language):**
   - For authorized practice questions containing system architecture diagrams or state machines, extract accessible textual descriptions and Mermaid diagram equivalents for study notes.
8. **Anki `.apkg` & Obsidian Vault Direct Sync:**
   - Complement the existing PDF, CSV, JSON, and Markdown exports with 1-click Anki deck packaging and bidirectional Obsidian frontmatter tags.
