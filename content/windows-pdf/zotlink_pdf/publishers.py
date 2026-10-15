"""Publisher DOI prefix and abbreviation helpers.

This table is intentionally curated rather than exhaustive. DOI prefixes are
assigned to registrants and may survive publisher mergers, platform changes, or
imprint transfers, so callers should treat matches as helpful hints.
"""

from __future__ import annotations

from dataclasses import dataclass

from .doi import normalize_doi


@dataclass(frozen=True)
class PublisherInfo:
    name: str
    abbreviation: str
    doi_prefixes: tuple[str, ...]
    aliases: tuple[str, ...] = ()


PUBLISHERS: tuple[PublisherInfo, ...] = (
    PublisherInfo("American Chemical Society", "ACS", ("10.1021",), ("ACS Publications",)),
    PublisherInfo("American Institute of Physics", "AIP", ("10.1063",), ("AIP Publishing",)),
    PublisherInfo("American Medical Association", "AMA", ("10.1001",), ("JAMA Network",)),
    PublisherInfo("American Physical Society", "APS", ("10.1103",), ()),
    PublisherInfo("Association for Computing Machinery", "ACM", ("10.1145",), ()),
    PublisherInfo("BMJ Publishing Group", "BMJ", ("10.1136",), ("BMJ",)),
    PublisherInfo("Elsevier", "Elsevier", ("10.1016",), ("ScienceDirect",)),
    PublisherInfo("Cambridge University Press", "CUP", ("10.1017",), ("Cambridge UP",)),
    PublisherInfo("Cell Press", "Cell", (), ("Elsevier Cell Press",)),
    PublisherInfo(
        "CSLI Publications",
        "CSLI",
        (),
        ("CSLI", "Center for the Study of Language and Information"),
    ),
    PublisherInfo(
        "Cengage Learning",
        "Cengage",
        (),
        ("Cengage Learning - M.U.A", "M.U.A"),
    ),
    PublisherInfo("De Gruyter", "De Gruyter", ("10.1515",), ("Walter de Gruyter",)),
    PublisherInfo("Brill", "Brill", ("10.1163",), ("Brill Academic",)),
    PublisherInfo("Duke University Press", "Duke UP", ("10.1215",), ("Duke UP",)),
    PublisherInfo("Edward Elgar Publishing", "Edward Elgar", ("10.4337",), ()),
    PublisherInfo("Emerald Publishing", "Emerald", ("10.1108",), ()),
    PublisherInfo("Frontiers Media", "Frontiers", ("10.3389",), ()),
    PublisherInfo("Hindawi", "Hindawi", ("10.1155",), ()),
    PublisherInfo("IEEE", "IEEE", ("10.1109",), ("Institute of Electrical and Electronics Engineers",)),
    PublisherInfo("IOP Publishing", "IOP", ("10.1088",), ("Institute of Physics",)),
    PublisherInfo("JMIR Publications", "JMIR", ("10.2196",), ()),
    PublisherInfo("John Benjamins Publishing Company", "John Benjamins", ("10.1075",), ("John Benjamins", "Benjamins")),
    PublisherInfo("Lexington Books/Fortress Academic", "Lexington Books/Fortress Academic", (), ()),
    PublisherInfo("MDPI", "MDPI", ("10.3390",), ()),
    PublisherInfo("MIT Press", "MIT Press", ("10.1162",), ()),
    PublisherInfo("Nature Portfolio", "Nature", ("10.1038",), ("Nature Publishing Group",)),
    PublisherInfo("Oxford University Press", "OUP", ("10.1093",), ("Oxford UP",)),
    PublisherInfo("Princeton University Press", "PUP", ("10.1515",), ("Princeton UP",)),
    PublisherInfo("Public Library of Science", "PLOS", ("10.1371",), ("PLoS",)),
    PublisherInfo("Royal Society of Chemistry", "RSC", ("10.1039",), ()),
    PublisherInfo(
        "Rowman & Littlefield Publishers, Incorporated",
        "Rowman & Littlefield Publishers",
        (),
        ("Rowman & Littlefield",),
    ),
    PublisherInfo("SAGE Publications", "SAGE", ("10.1177",), ()),
    PublisherInfo("Science", "AAAS", ("10.1126",), ("American Association for the Advancement of Science",)),
    PublisherInfo("Springer Nature", "Springer", ("10.1007", "10.1057"), ("Springer", "Palgrave Macmillan")),
    PublisherInfo("Taylor & Francis", "T&F", ("10.1080",), ("Routledge", "CRC Press")),
    PublisherInfo("Manchester University Press", "MUP", ("10.7765",), ("Manchester UP",)),
    PublisherInfo("University of Chicago Press", "UCP", ("10.1086",), ("Chicago Journals",)),
    PublisherInfo("University of California Press", "UC Press", ("10.1525",), ("California UP",)),
    PublisherInfo("University of Michigan Press", "UMP", (), ("Michigan UP",)),
    PublisherInfo("Wiley", "Wiley", ("10.1002", "10.1111"), ("John Wiley & Sons", "Wiley-Blackwell")),
    PublisherInfo("World Scientific", "WSPC", ("10.1142",), ()),
    PublisherInfo("Yale University Press", "YUP", ("10.12987",), ("Yale UP",)),
)


def doi_prefix(doi: str | None) -> str | None:
    normalized = normalize_doi(doi)
    if not normalized:
        return None
    pieces = normalized.split("/", 1)[0].split(".")
    if len(pieces) < 2:
        return None
    return ".".join(pieces[:2])


def publisher_for_doi(doi: str | None) -> PublisherInfo | None:
    prefix = doi_prefix(doi)
    if not prefix:
        return None
    for publisher in PUBLISHERS:
        if prefix in publisher.doi_prefixes:
            return publisher
    return None


def publisher_for_name(name: str | None) -> PublisherInfo | None:
    if not name:
        return None
    normalized = name.casefold()
    for publisher in PUBLISHERS:
        names = (publisher.name, publisher.abbreviation, *publisher.aliases)
        if any(candidate.casefold() == normalized for candidate in names):
            return publisher
    for publisher in PUBLISHERS:
        names = (publisher.name, *publisher.aliases)
        if any(candidate.casefold() in normalized or normalized in candidate.casefold() for candidate in names):
            return publisher
    return None
