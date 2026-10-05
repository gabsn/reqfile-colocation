from voice.models.loaders import load


def answer(prompt: str) -> str:
    return load().generate(prompt)
