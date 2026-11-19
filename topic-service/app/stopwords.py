"""Indonesian stopwords for the c-TF-IDF tokenization step.

Job profiles are written in Indonesian, so the CountVectorizer that feeds
c-TF-IDF needs Indonesian stopword removal — otherwise every topic's top words
are "dan / yang / untuk". Sastrawi provides the canonical Indonesian stopword
list; we add a small set of job-profile boilerplate that appears in nearly every
document and carries no topical signal. (c-TF-IDF's reduce_frequent_words also
downweights ubiquitous terms, so this list stays conservative.)
"""

from functools import lru_cache

# Boilerplate that recurs across job-profile documents regardless of topic.
_EXTRA_STOPWORDS = {
    "jabatan", "posisi", "departemen", "divisi", "bagian", "unit",
    "tugas", "tanggung", "jawab", "wewenang", "melakukan", "melaksanakan",
    "bertanggung", "terkait", "sesuai", "serta", "dll", "yakni",
    "perusahaan", "kerja", "pekerjaan", "fungsi", "peran", "uraian",
}


@lru_cache(maxsize=1)
def indonesian_stopwords() -> list[str]:
    words: set[str] = set()
    try:
        from Sastrawi.StopWordRemover.StopWordRemoverFactory import StopWordRemoverFactory

        words |= set(StopWordRemoverFactory().get_stop_words())
    except Exception:
        # Sastrawi unavailable → fall back to the boilerplate set only. The
        # pipeline still works, keywords are just slightly noisier.
        pass
    words |= _EXTRA_STOPWORDS
    return sorted(words)


def stopwords_for(lang: str):
    """Resolve the config `stopwords` selector into a CountVectorizer stop_words
    value: a word list, the string 'english' (sklearn built-in), or None.

      'indonesian' → Sastrawi list + job-profile boilerplate (default)
      'english'    → sklearn's built-in English stopword list
      'none'       → None (keep every token)
    """
    key = (lang or "indonesian").strip().lower()
    if key == "none":
        return None
    if key == "english":
        return "english"
    # 'indonesian' / anything else → Indonesian.
    return indonesian_stopwords()
