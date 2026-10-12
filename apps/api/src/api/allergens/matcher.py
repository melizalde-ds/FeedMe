"""Matches food text against allergen_reference.json. Standard library only.

    matcher = AllergenMatcher.load()
    result = matcher.classify(["vanilla yogurt", "lemon juice"], mode="recipe")
    matcher.decide(result, profile)["verdict"]     # unsafe | caution | unknown | safe

Kept as supplied with the reference file, minus its command line. The rules for
what this app blocks are in api.allergens.profile, not here.

To extend the data, append rows to "terms" / "negatives" in the JSON
(or load several JSON files and concatenate those lists before constructing).
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

# ---------------------------------------------------------------- normalize
import unicodedata

SPELLING = {
    "sulphite": "sulfite", "sulphur": "sulfur", "sulphiting": "sulfiting",
    "bisulphite": "bisulfite", "metabisulphite": "metabisulfite",
    "sulphurous": "sulfurous", "sulfites": "sulfite",
    "flavour": "flavor", "flavouring": "flavoring", "flavoured": "flavored",
    "colour": "color", "colouring": "coloring",
    "yoghurt": "yogurt", "yoghourt": "yogurt",
    "mollusk": "mollusc", "coeliac": "celiac", "fibre": "fiber",
    "savoury": "savory", "chilli": "chili", "gelatine": "gelatin",
    "pasteurized": "pasteurised", "hydrolysed": "hydrolyzed",
    "homogenised": "homogenized", "caramelised": "caramelized",
    "houmous": "hummus", "hommus": "hummus", "humus": "hummus",
    "omelette": "omelet", "ghanoush": "ganoush", "ghanouj": "ganoush",
    "halvah": "halva", "halawa": "halva",
}

IRREGULAR = {
    "leaves": "leaf", "loaves": "loaf", "halves": "half", "knives": "knife",
    "geese": "goose", "teeth": "tooth", "anchovies": "anchovy",
    "cookies": "cookie", "brownies": "brownie", "pastries": "pastry",
    "berries": "berry", "cherries": "cherry", "fries": "fry", "patties": "patty",
    "dories": "dory", "lychees": "lychee", "lichees": "lichee",
}

# Words that end in s but are not plurals (or whose plural form is the name).
NO_SINGULAR = {
    "hummus", "couscous", "asparagus", "molasses", "swiss", "bass", "grass",
    "glass", "lens", "series", "species", "gas", "bus", "plus", "us", "this",
    "is", "was", "has", "yes", "its", "his", "less", "kumiss", "citrus",
    "octopus", "abalone", "haggis", "tapas", "nachos", "pancreas", "brussels",
    "ras", "anis", "anise", "chips", "grits",
    "jus", "lotus", "cactus", "hibiscus", "aloes", "mais", "harissa",
    "bouillabaisse", "aioli", "cassis", "pastis",
}

_E_NUMBER = re.compile(r"\be\s*[-‐-―]?\s*(\d{3,4}[a-z]?)\b")
_TOKEN = re.compile(r"[a-z0-9]+")


def strip_accents(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    return "".join(c for c in text if not unicodedata.combining(c))


def singularize(tok: str) -> str:
    if tok in IRREGULAR:
        return IRREGULAR[tok]
    if tok in NO_SINGULAR or len(tok) <= 3 or tok.isdigit():
        return tok
    if tok.endswith("ies") and len(tok) > 4:
        return tok[:-3] + "y"
    if tok.endswith("oes") and len(tok) > 4:
        return tok[:-2]
    if tok.endswith(("sses", "shes", "ches", "xes", "zes")):
        return tok[:-2]
    if tok.endswith(("ss", "us", "is")):
        return tok
    if tok.endswith("s"):
        return tok[:-1]
    return tok


def normalize_token(tok: str) -> str:
    tok = SPELLING.get(tok, tok)
    tok = singularize(tok)
    return SPELLING.get(tok, tok)


def prepare(text: str) -> str:
    """Lowercase/accent/apostrophe/E-number cleanup, before tokenizing."""
    text = strip_accents(text.lower())
    text = text.replace("’", "'").replace("‘", "'").replace("`", "'")
    text = re.sub(r"(\w)'s\b", r"\1", text)      # cow's -> cow
    text = re.sub(r"s'(\s|$)", r"s\1", text)     # goats' -> goats
    text = text.replace("'", "")                 # za'atar -> zaatar
    text = text.replace("&", " and ")
    text = _E_NUMBER.sub(lambda m: " e" + m.group(1) + " ", text)
    return text


def tokens(text: str) -> list[str]:
    return [normalize_token(t) for t in _TOKEN.findall(prepare(text))]


def phrase(text: str) -> str:
    """Canonical lexicon key for a term."""
    return " ".join(tokens(text))


tokenize = tokens
norm = phrase

# ---------------------------------------------------------------- matcher

TIER_RANK = {"declared": 8, "contains": 7, "likely": 6, "exempt_derivative": 5,
             "may_contain": 4.5, "check_label": 4, "related": 3, "broad_category": 2}
POSITIVE_STRONG = {"declared", "contains", "likely", "exempt_derivative"}
NEGATORS_BEFORE = {"no", "without", "non", "free"}  # 'free from x' handled too

_MAY = re.compile(
    r"(?:may\s+(?:also\s+)?contain|may\s+include|may\s+have\s+come\s+(?:in|into)\s+contact\s+with"
    r"|(?:produced|processed|manufactured|made|packed|packaged)\s+(?:in|on)\s+(?:a\s+)?"
    r"(?:facility|factory|plant|site|equipment|shared\s+equipment|a\s+line)"
    r"(?:\s+(?:that|which))?(?:\s+also)?(?:\s+(?:processes|handles|uses|produces|with))?"
    r"|(?:made|processed)\s+on\s+shared\s+(?:equipment|lines?)\s+with"
    r"|(?:may\s+contain\s+)?traces?\s+of"
    r"|not\s+suitable\s+for\s+(?:people|those|persons|customers)\s+with\s+(?:an?\s+)?allerg(?:y|ies)\s+to)"
    r"\s*:?\s*([^.;\n]*)", re.I)
_CONTAINS = re.compile(
    r"(?:\ballergens?\s*:\s*|\ballergy\s+(?:advice|information)\s*:\s*|\bcontains\b"
    r"(?!\s*(?:\d|less|not\s+more|one|two|less\s+than))\s*:?\s*)([^.;\n]*)", re.I)
_INGREDIENTS_LABEL = re.compile(r"^\s*ingredients?\s*:?\s*", re.I)


@dataclass
class Hit:
    group: str
    tier: str
    phrase: str
    item: str
    subgroup: str | None = None
    verification: str = "sourced"
    sources: list = field(default_factory=list)
    note: str | None = None
    via: str = "ingredient"           # ingredient | declared | may_contain | prefix
    downgraded_by: str | None = None

    def as_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if v not in (None, [], "")}


class AllergenMatcher:
    def __init__(self, lex: dict) -> None:
        if "phrases" not in lex:                      # flat reference format
            phrases: dict = {}
            for t in lex["terms"]:
                rec = phrases.setdefault(t["phrase"], {"entries": [], "negates": []})
                rec["entries"].append(dict(t, verification=t.get("verification", "sourced")))
            for n in lex.get("negatives", []):
                rec = phrases.setdefault(n["phrase"], {"entries": [], "negates": []})
                rec["negates"] = sorted(set(rec["negates"]) | set(n["not_groups"]))
            lex = dict(lex, phrases=phrases)
        self.lex = lex
        self.P = {tuple(k.split()): v for k, v in lex["phrases"].items()}
        self.max_len = max(len(k) for k in self.P)
        self.safe = {tuple(w.split()) for w in lex["known_safe"]}
        self.safe_max = max((len(k) for k in self.safe), default=1)
        self.stop = set(lex["stopwords"])
        self.free_from = {tuple(k.split()): v for k, v in lex["free_from_terms"].items()}
        self.downgrade = {tuple(k.split()): v for k, v in lex.get("downgrade_words", {}).items()}
        self.groups = lex["groups"]
        self.relations = lex["relations"]
        self.prefix_rules = lex["prefix_rules"]
        self.user_phrases = lex["user_phrases"]
        self.umbrella = lex["umbrella_terms"]

    @classmethod
    def load(cls, *paths: str | Path):
        """Load one or more reference files; terms/negatives lists are concatenated."""
        paths = paths or (Path(__file__).resolve().parent / "allergen_reference.json",)
        base = json.loads(Path(paths[0]).read_text(encoding="utf-8"))
        for p in paths[1:]:
            extra = json.loads(Path(p).read_text(encoding="utf-8"))
            for k in ("terms", "negatives", "relations", "prefix_rules"):
                base[k] = base.get(k, []) + extra.get(k, [])
            for k in ("groups", "user_phrases", "free_from_terms", "downgrade_words", "sources"):
                base[k] = {**base.get(k, {}), **extra.get(k, {})}
            base["known_safe"] = sorted(set(base.get("known_safe", [])) | set(extra.get("known_safe", [])))
        return cls(base)

    # ------------------------------------------------------------------ scan
    def _scan(self, toks: tuple, skip_full: bool = False) -> list[tuple[int, int]]:
        spans, i, n = [], 0, len(toks)
        while i < n:
            for L in range(min(self.max_len, n - i), 0, -1):
                if skip_full and i == 0 and L == n:
                    continue
                if toks[i:i + L] in self.P:
                    spans.append((i, i + L))
                    i += L
                    break
            else:
                i += 1
        return spans

    def _freed_groups(self, toks: tuple, spans) -> tuple[set, set]:
        """Groups negated by free-from wording, and token indexes used by it."""
        freed, used = set(), set()
        self._last_downgrade_pos = set()
        self._last_freeings = []
        n = len(toks)
        for i in range(n):
            for L in range(min(3, n - i), 0, -1):
                key = toks[i:i + L]
                if key not in self.free_from:
                    continue
                after = toks[i + L] if i + L < n else None
                before = toks[i - 1] if i > 0 else None
                before2 = toks[i - 2:i] if i > 1 else ()
                if after == "free" or before in ("no", "without", "non") \
                        or before2 == ("free", "from") or before2 == ("free", "of"):
                    gs = self.free_from[key]
                    gs = set(self.groups) if "*" in gs else set(gs)
                    pos = set(range(i, i + L))
                    if after == "free":
                        pos.add(i + L)
                    elif before in ("no", "without", "non"):
                        pos.add(i - 1)
                    else:
                        pos |= {i - 2, i - 1}
                    freed |= gs
                    used |= pos
                    self._last_freeings.append((pos, gs))
                break
        for i in range(n):
            for L in range(min(3, n - i), 0, -1):
                if toks[i:i + L] in self.downgrade:
                    gs = set(self.downgrade[toks[i:i + L]])
                    freed |= gs
                    self._last_downgrade_pos |= set(range(i, i + L))
                    self._last_freeings.append((set(range(i, i + L)), gs))
                    break
        return freed, used

    @lru_cache(maxsize=20000)
    def _resolve(self, ptoks: tuple) -> tuple:
        """Entries for a lexicon phrase, including inherited sub-phrase groups."""
        rec = self.P[ptoks]
        negates = set(rec["negates"])
        out = [dict(e, _phrase=" ".join(ptoks)) for e in rec["entries"]]
        if len(ptoks) > 1:
            subs = self._scan(ptoks, skip_full=True)
            freed, _ = self._freed_groups(ptoks, subs)
            own: dict = {}
            for e in rec["entries"]:
                # exempt/related classifications of a phrase are deliberate and
                # are not overridden by the words inside it ('peanut oil')
                r = 99 if e["tier"] in ("exempt_derivative", "related") or e.get("authoritative") \
                    else TIER_RANK[e["tier"]]
                own[e["group"]] = max(own.get(e["group"], 0), r)
            for a, b in subs:
                for e in self._resolve(ptoks[a:b]):
                    g = e["group"]
                    if e.get("standalone") or g in negates or TIER_RANK[e["tier"]] <= own.get(g, 0):
                        continue
                    e = dict(e)
                    if g in freed and TIER_RANK[e["tier"]] > TIER_RANK["check_label"]:
                        e["tier"], e["_down"] = "check_label", "free-from wording"
                    if any(e["group"] == x["group"] and e.get("subgroup") == x.get("subgroup")
                           and e["tier"] == x["tier"] for x in out):
                        continue
                    out.append(e)
        return tuple(out)

    def _prefix_hits(self, tok: str, item: str) -> list[Hit]:
        hits = []
        for r in self.prefix_rules:
            if tok.startswith(r["prefix"]) and len(tok) >= r.get("min_length", 0) \
                    and tok not in r.get("except", []):
                hits.append(Hit(r["group"], r["tier"], tok, item, note=r.get("note"),
                                sources=[r["source"]] if r.get("source") else [], via="prefix"))
        return hits

    def match_item(self, text: str, via: str = "ingredient") -> tuple[list[Hit], list[str]]:
        toks = tuple(tokenize(text))
        spans = self._scan(toks)
        freed, used = self._freed_groups(toks, spans)
        freeings = list(self._last_freeings)
        covered = set(used) | self._last_downgrade_pos
        hits: list[Hit] = []
        for a, b in spans:
            covered |= set(range(a, b))
            rng = set(range(a, b))
            span_is_freeing = rng <= used
            # free-from wording wholly inside this phrase is already handled by
            # the phrase itself (e.g. 'non dairy creamer', 'gluten free bread')
            applicable = set()
            for pos, gs in freeings:
                if not pos <= rng or span_is_freeing:
                    applicable |= gs
            for e in self._resolve(toks[a:b]):
                if span_is_freeing and e["group"] in freed:
                    continue                       # the word 'dairy' in 'dairy-free'
                tier, down = e["tier"], e.get("_down")
                if e["group"] in applicable and TIER_RANK[tier] > TIER_RANK["check_label"]:
                    tier, down = "check_label", "free-from wording"
                if via in ("declared", "may_contain") and tier != "broad_category":
                    tier = via
                hits.append(Hit(e["group"], tier, e["_phrase"], text, e.get("subgroup"),
                                e.get("verification", "sourced"), e.get("sources", []),
                                e.get("note"), via, down))
        # prefix rules + unknown detection on uncovered tokens
        unknown = []
        i = 0
        while i < len(toks):
            if i in covered:
                i += 1
                continue
            for L in range(min(self.safe_max, len(toks) - i), 0, -1):
                if toks[i:i + L] in self.safe:
                    covered |= set(range(i, i + L))
                    break
            if i in covered:
                i += 1
                continue
            t = toks[i]
            ph = self._prefix_hits(t, text)
            if ph:
                hits += ph
            elif not (t in self.stop or t.isdigit() or re.fullmatch(r"\d+[a-z]{0,3}", t)
                      or re.fullmatch(r"e\d{3,4}[a-z]?", t)):
                unknown.append(t)
            i += 1
        return hits, unknown

    # -------------------------------------------------------------- classify
    def classify(self, text, mode: str = "label") -> dict:
        if mode not in ("label", "recipe", "dish"):
            raise ValueError("mode must be label, recipe or dish")
        declared, may = [], []
        if mode == "label":
            body = text if isinstance(text, str) else ", ".join(text)
            for m in _MAY.finditer(body):
                may.append(m.group(1).strip())
            body = _MAY.sub(" . ", body)
            for m in _CONTAINS.finditer(body):
                declared.append(m.group(1).strip())
            body = _CONTAINS.sub(" . ", body)
            body = _INGREDIENTS_LABEL.sub("", body)
            items = [s.strip(" .*:-") for s in re.split(r"[,;()\[\]{}\n]|\.\s", body)]
        elif mode == "recipe":
            lines = text.splitlines() if isinstance(text, str) else list(text)
            items = [re.sub(r"^\s*[-*•\d.)]+\s+", "", l).strip() for l in lines]
        else:
            items = [text] if isinstance(text, str) else list(text)
        items = [i for i in items if i and re.search(r"[A-Za-z]", i)]

        out_items, all_hits = [], []
        for it in items:
            hits, unk = self.match_item(it)
            out_items.append({"text": it, "hits": [h.as_dict() for h in hits],
                              "unrecognized": unk})
            all_hits += hits
        for seg in declared:
            for part in re.split(r",|\band\b|&", seg):
                if part.strip():
                    hits, _ = self.match_item(part, via="declared")
                    all_hits += hits
        for seg in may:
            for part in re.split(r",|\band\b|&|\bor\b", seg):
                if part.strip():
                    hits, _ = self.match_item(part, via="may_contain")
                    all_hits += hits

        summary: dict = {}
        for h in all_hits:
            cur = summary.get(h.group)
            if cur is None or TIER_RANK[h.tier] > TIER_RANK[cur["tier"]]:
                summary[h.group] = {"tier": h.tier, "evidence": []}
            summary[h.group]["evidence"].append(h.as_dict())
        return {
            "mode": mode,
            "items": out_items,
            "declared_statements": declared,
            "may_contain_statements": may,
            "groups": summary,
            "unrecognized_items": [i["text"] for i in out_items if i["unrecognized"]],
        }

    # --------------------------------------------------------------- profile
    def resolve_profile(self, phrases, strict: bool = False) -> tuple[dict, list]:
        """User statements -> profile. Ambiguous umbrella terms include every
        group (fail closed) and return a question to ask the user."""
        groups: dict = {}
        questions, notes = [], []
        for raw in phrases:
            p = norm(raw)
            found = self.user_phrases.get(p)
            if not found:
                core = re.sub(r"\b(allergy|allergic|allergie|intolerance|intolerant|to|free|no|sensitivity|sensitive)\b",
                              " ", p).strip()
                found = self.user_phrases.get(core)
                if not found and core:
                    hits, _ = self.match_item(core)
                    gs = sorted({h.group for h in hits if h.tier in ("contains",)})
                    found = [{"group": g, "scope": None} for g in gs]
                    if gs:
                        notes.append(f"'{raw}' mapped to whole group(s) {gs}; allergists usually "
                                     "advise avoiding the whole group until tested.")
            if not found:
                questions.append({"phrase": raw, "ask": f"I couldn't map '{raw}' to an allergen group. Which allergen is it?"})
                continue
            gset = {f["group"] for f in found}
            for name, u in self.umbrella.items():
                if u.get("ask_user") and set(u["groups"]) == gset and len(gset) > 1:
                    questions.append({"phrase": raw, "ask": u["ask_user"], "defaulted_to": sorted(gset)})
            for f in found:
                g = groups.setdefault(f["group"], {"scope": f["scope"]})
                if f["scope"] is None or g["scope"] is None:
                    g["scope"] = None
                else:
                    g["scope"] = sorted(set(g["scope"]) | set(f["scope"]))
            if "lactose" in p:
                notes.append("Lactose intolerance mapped to the milk group (safe default); "
                             "add 'milk' to profile['relax'] if the user only wants warnings.")
        profile = {"groups": groups, "strict": strict, "allow_exempt": [], "relax": [],
                   "notes": notes}
        return profile, questions

    # ---------------------------------------------------------------- decide
    def decide(self, result: dict, profile: dict) -> dict:
        strict = profile.get("strict", False)
        allow_exempt = set(profile.get("allow_exempt", []))
        relax = set(profile.get("relax", []))
        ugroups = profile["groups"]
        rel = {}
        for r in self.relations:
            if r["user_group"] in ugroups:
                rel.setdefault(r["hit_group"], r)
        reasons = []
        for gid, info in result["groups"].items():
            for h in info["evidence"]:
                tier = h["tier"]
                action, why = None, None
                if gid in ugroups:
                    scope = ugroups[gid].get("scope")
                    if scope and h.get("subgroup") and h["subgroup"] not in scope:
                        continue
                    if scope and not h.get("subgroup") and TIER_RANK[tier] > TIER_RANK["check_label"]:
                        tier = "check_label"
                    action = {
                        "declared": "block", "contains": "block", "likely": "block",
                        "exempt_derivative": "warn" if gid in allow_exempt else "block",
                        "may_contain": "block" if strict else "warn",
                        "check_label": "block" if strict else "warn",
                        "related": "warn",
                        "broad_category": "warn" if strict else "info",
                    }[tier]
                    if gid in relax and action == "block":
                        action, why = "warn", "group relaxed by user"
                elif gid in rel and tier in POSITIVE_STRONG:
                    action, why = "warn", rel[gid]["note"]
                if action:
                    reasons.append({"action": action, "group": gid, "tier": tier,
                                    "phrase": h["phrase"], "item": h["item"],
                                    "verification": h.get("verification"),
                                    "note": why or h.get("note")})
        acts = {r["action"] for r in reasons}
        unknown = result["unrecognized_items"]
        if "block" in acts:
            verdict = "unsafe"
        elif "warn" in acts:
            verdict = "caution"
        elif unknown:
            verdict = "unknown"
        else:
            verdict = "safe"
        caveats = []
        if result["mode"] == "dish" and verdict == "safe":
            verdict = "unknown"
            caveats.append("A dish name can't prove an allergen is absent; check the recipe or ask the kitchen.")
        if result["mode"] == "label" and verdict in ("safe", "unknown"):
            us_unlisted = [g for g in ugroups if "not" in self.groups.get(g, {})
                           .get("regulatory_status", {}).get("us_fda", "").lower()[:12]]
            if us_unlisted:
                caveats.append("US labels don't have to declare " + ", ".join(us_unlisted)
                               + "; a missing 'Contains' entry is not evidence for these.")
        order = {"block": 0, "warn": 1, "info": 2}
        reasons.sort(key=lambda r: (order[r["action"]], -TIER_RANK[r["tier"]]))
        return {"verdict": verdict, "reasons": reasons, "unrecognized_items": unknown,
                "caveats": caveats}
