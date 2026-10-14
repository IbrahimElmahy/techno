from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class WbProfile:
    key: str
    branch: str
    plumber_prefix: str
    owner_prefix: str
    trader_prefix: str
    visit_prefix: str
    issue_prefix: str
    receipt_prefix: str
    issue_ref_prefix: str
    a5_prefix: str
    default_dir: str
    emp_to_user: dict[str, str] = field(default_factory=dict)
    trader_alias: dict[str, str] = field(default_factory=dict)
    coupon_kind_by_prefix: dict[str, str] = field(default_factory=dict)
    zero_value_unknown: bool = False

    def a5_code(self, raw: str | None) -> str:
        s = (raw or "").strip()
        if not s or s == "0":
            return ""
        if s.startswith(("A5-", "AL-A5-", "FC-A5-", "A5X", "AL-A5X", "FC-A5X")):
            return s
        return self.a5_prefix + s if s.isdigit() else ""

    def issue_ref(self, customer_id: int, issue_date: object, kind: str | None,
                  rep_id: int) -> str:
        return f"{self.issue_ref_prefix}{customer_id}:{issue_date}:{kind}:{rep_id}"


ALIAA = WbProfile(
    key="aliaa",
    branch="العلياء",
    plumber_prefix="WB-P-",
    owner_prefix="WB-C-",
    trader_prefix="WB-T-",
    visit_prefix="WBV-",
    issue_prefix="WBI-",
    receipt_prefix="WBR-",
    issue_ref_prefix="wb:",
    a5_prefix="AL-A5-",
    default_dir="C:/pgtmp/wb2",
    emp_to_user={
        "EMP-0053": "ashraf",
        "EMP-0002": "ibrahim.khattab",
        "EMP-0003": "anas",
        "EMP-0008": "bayoumy",
        "EMP-0004": "hassan.eid",
        "EMP-0005": "ahmed.torky",
        "EMP-0054": "care",
        "EMP-0006": "mohamed.mamdouh",
        "EMP-0007": "medhat.kh",
        "EMP-0055": "mohamed.torky",
        "EMP-0040": "sales.dept2",
        "EMP-0045": "mandob_a",
        "EMP-0043": "car.b",
        "EMP-0046": "manbod_car.g",
        "EMP-0044": "car.d",
        "EMP-0047": "car.sh",
    },
    trader_alias={"1001355": "A5X1"},
    coupon_kind_by_prefix={},
)

OCTOBER = WbProfile(
    key="october",
    branch="أكتوبر",
    plumber_prefix="WBO-P-",
    owner_prefix="WBO-C-",
    trader_prefix="WBO-T-",
    visit_prefix="WBOV-",
    issue_prefix="WBOI-",
    receipt_prefix="WBOR-",
    issue_ref_prefix="wbo:",
    a5_prefix="A5-",
    default_dir="D:/tmp/cs_oct/tsv",
    emp_to_user={
        "10030": "kamel.helal",
        "10034": "abdelrahman.gomaa",
        "10035": "amr.ragab",
        "10041": "fayoum",
        "10042": "mohamed.mamdouh",
        "10044": "mohamed.gamil",
        "10045": "medhat.kh",
        "10047": "mohamed.samy.oct",
        "10048": "mohamed.mahmoud.oct",
        "10049": "mahmoud.marzouk",
    },
    trader_alias={},
    coupon_kind_by_prefix={"G": "ذهبى", "S": "فضى", "W": "ابيض"},
    zero_value_unknown=True,
)

PROFILES: dict[str, WbProfile] = {p.key: p for p in (ALIAA, OCTOBER)}


def profile_from_argv(argv: list[str]) -> WbProfile:
    key = "aliaa"
    for i, a in enumerate(argv):
        if a == "--branch" and i + 1 < len(argv):
            key = argv[i + 1]
        elif a.startswith("--branch="):
            key = a.split("=", 1)[1]
    key = key.strip().lower()
    if key not in PROFILES:
        raise SystemExit(f"فرع غير معروف «{key}». الخيارات: {', '.join(PROFILES)}")
    return PROFILES[key]


def dir_from_argv(argv: list[str], profile: WbProfile) -> str:
    if "--dir" in argv and argv.index("--dir") + 1 < len(argv):
        return argv[argv.index("--dir") + 1]
    return profile.default_dir
