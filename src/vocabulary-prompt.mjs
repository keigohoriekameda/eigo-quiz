export function validVocabularyContext(question) {
  return typeof question.context_en === 'string' &&
    (question.context_en.trim() !== '' ||
      (question.stage === 'PRE' && question.unit_type === 'word' &&
        question.prompt_type === 'meaning_4choice' && question.context_en === ''));
}

export function readyForEditorialApproval(question) {
  const part = question.part_of_speech;
  return validVocabularyContext(question) &&
    typeof part === 'string' && part.trim() !== '' && !['unspecified', 'vocabulary'].includes(part) &&
    (question.quality_flags === undefined ||
      (Array.isArray(question.quality_flags) && question.quality_flags.length === 0));
}
