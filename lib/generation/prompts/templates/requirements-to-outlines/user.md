Please generate scene outlines based on the following course requirements.

---

## User Requirements

{{requirement}}

---

{{userProfile}}

## Course Language

Required language: {{language}}

If language is zh-CN, all content must be in Chinese. If language is en-US, all content must be in English.

---

## Reference Materials

### PDF Content Summary

{{pdfContent}}

### Available Images

{{availableImages}}

### Web Search Results

{{researchContext}}

{{teacherContext}}

---

## Output Requirements

Infer these details from the user requirements:

- Course topic and core content
- Target audience and difficulty
- Course duration, defaulting to 15-30 minutes if unspecified
- Teaching style
- Visual style

Then output a JSON array containing all scene outlines. Each scene must include:

```json
{
  "id": "scene_1",
  "type": "slide",
  "title": "Scene Title",
  "description": "Teaching purpose description",
  "keyPoints": ["Point 1", "Point 2", "Point 3"],
  "order": 1
}
```

## Special Notes

1. Quiz scenes must include `quizConfig`.
2. If images are available, add `suggestedImageIds` to relevant slide scenes.
3. Interactive scenes must include `interactiveConfig` with `conceptName`, `conceptOverview`, `designIdea`, and `subject`. Limit to 1-2 interactive scenes per course.
4. For interactive scenes, keep `designIdea` simple: prefer one core interaction and at most 1-2 supporting controls.
5. Prefer stable classroom templates over complex custom dashboards or calculator-like interfaces.
6. Avoid side panels, dense control groups, or redundant summaries unless the user explicitly requires that level of complexity.
7. Scene count should match inferred duration, typically 1-2 scenes per minute.
8. Recommend inserting a quiz every 3-5 slides for assessment.
9. Strictly output all content in the specified course language.
10. Do not include `mediaGenerations`. AI image generation and AI video generation are not available in this classroom pipeline.
11. Do not invent generated image/video IDs such as `gen_img_1` or `gen_vid_1`.
12. If no suitable provided image exists, design the scene with text, charts, tables, shapes, formulas, or interactive content instead.
13. If web search results are provided, reference specific findings and sources in scene descriptions and keyPoints.

{{mediaGenerationPolicy}}

Please output JSON array directly without additional explanatory text.
