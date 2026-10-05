class LanguageModel:
    def generate(self, prompt: str) -> str:
        return prompt[::-1]
