# nmts

*[English](README.md)*

[NMTS](https://nmts.me)를 터미널에서 쓰는 도구입니다 — Walrus 네트워크 위의 종단 간 암호화 저장소를,
터미널 앞의 사람과 그 사람이 돌리는 에이전트를 위해.

> **이야기를 나누는 곳: [디스코드](https://discord.gg/pcmRkVmVZk).** 영어와 한국어 둘 다 읽습니다.
>
> **AI 에이전트라면 [AGENTS.md](AGENTS.md)를 대신 읽으십시오.** 같은 내용을 프로그램이 필요로 하는
> 순서로 적어 두었습니다. (영어입니다.)
>
> **상태: 이릅니다.** 1.0 전에 인터페이스가 더 바뀔 수 있습니다. 지금 무엇이 있는지의 정본은
> `nmts --help`입니다.

## NMTS가 무엇인가

**암호화가 내 기계에서 일어나고 열쇠가 기기 밖으로 나가지 않는** 저장소입니다. 서버는 암호화된
바이트를 받을 뿐 열지 못합니다. 파일 내용도, 이름도, 폴더도 전부 계정 코드만이 여는 암호화된
목록 안에 있습니다.

바이트는 공개 저장 네트워크인 **Walrus**에 있고, 값은 **Sui** 체인에서 치릅니다. 시작하기 전에
알아 둘 것이 셋 있습니다.

- **저장은 영원히가 아니라 기간을 사는 것입니다.** 파일에는 기한이 있습니다. 연장할 수 있고, 끝나기
  전에 NMTS가 알려 줍니다.
- **비밀번호 재설정이 없습니다.** 계정 코드가 곧 계정입니다. 되찾을 수 없고, 파일을 그대로 둔 채
  바꿀 수도 없습니다. NMTS를 포함해 누구도 그 파일을 못 여는 것과 같은 성질입니다.
- **여기서 하는 업로드는 계정이 이미 가진 크레딧으로 냅니다.** 명령 하나, `nmts extend`만 내 Sui
  지갑에서 직접 내고, 그 전에 별도의 동의를 받습니다. 공개 체인에서 서명해 산 것은 누구도 되돌릴 수
  없기 때문입니다.

## 설치

Node 22 이상. 설치할 때 컴파일하는 것이 없고 네이티브 빌드 단계도 없습니다. 암호화 엔진은
저장소에 실린 WebAssembly 모듈이라, Node가 도는 곳이면 어디서든 돕니다 — 리눅스, macOS, 윈도우,
그리고 rootless 컨테이너 안에서도.

```sh
npm install -g @needmoretruth/nmts-cli
nmts --help
```

같은 패키지를 등록소 없이 이 저장소에서 바로 설치할 수도 있습니다 — 기본 브랜치, 고정한 버전,
또는 [최신 릴리스](https://github.com/needmoretruth/nmts-cli/releases)에 붙은 tarball로:

```sh
npm install -g github:needmoretruth/nmts-cli            # 기본 브랜치
npm install -g github:needmoretruth/nmts-cli#v0.18.0    # 버전을 고정할 때
npm install -g https://github.com/needmoretruth/nmts-cli/releases/latest/download/nmts.tgz
```

등록소의 이름에는 스코프가 붙습니다. `npm install -g nmts`는 아무것도 찾지 못합니다 — 그 짧은
이름은 이미 있는 이름과 너무 비슷하다며 등록소가 거절하기 때문입니다.

소스를 직접 고치려면 [CONTRIBUTING.ko.md](CONTRIBUTING.ko.md)를 보십시오.

## 최신으로 유지하기

```sh
nmts update            # 가장 새 릴리스를 지금 것 위에 설치합니다
nmts update --dry-run  # 버전과 실행할 명령만 찍고 아무것도 바꾸지 않습니다
```

이와 별개로, 하루에 한 번 명령이 끝난 뒤 릴리스 페이지에 가장 새 버전이 무엇인지 묻고 답을 적어
둡니다. 더 새 것이 있으면 다음 실행이 stderr에 한 줄을 찍습니다. 그 요청에는 계정 코드도, API 키도,
명령 이름도 실리지 않으며, 어떤 명령도 시키지 않았는데 이 도구가 하는 유일한 요청입니다.
`NMTS_NO_UPDATE_CHECK`에 아무 값이나 넣으면 둘 다 멈추고, `nmts env`가 마지막에 무엇을 알아냈는지 보여
줍니다.

## 처음 돌릴 때

```sh
nmts env       # 이 기계가 무엇이고 자격이 손에 닿는지. 아무 데도 접속하지 않습니다.
nmts login     # 계정 코드를 여기에 잠가 두고, API 키를 받습니다
nmts ls        # 파일 목록
nmts put x     # 파일 하나 업로드 — 크레딧을 씁니다
nmts get x     # 파일 하나 다운로드
```

모르는 기계 — 컨테이너, CI 러너, 남의 노트북 — 에서는 `nmts env`를 먼저 돌리십시오. 자격이 필요
없고, 여기에 둔 자격이 무엇에 노출되는지를 알려 줍니다.

## 자격은 둘입니다

하는 일이 다르고, 서로 바꿔 쓸 수 없습니다.

| | 하는 일 | 건네는 법 |
|---|---|---|
| **계정 코드** | 파일을 엽니다. 계정의 모든 열쇠가 여기서 나옵니다. 서버로 가지 않습니다. | `NMTS_ACCOUNT_CODE_FILE=/path`(권장) · `nmts login` · `NMTS_ACCOUNT_CODE` |
| **API 키** | 서버가 답하게 합니다. nmts.me의 계정 화면에서 만듭니다. 파일은 열지 못합니다. | `NMTS_API_KEY_FILE=/path`(권장) · `NMTS_API_KEY` · `nmts login` |

`nmts ls`는 둘 다 필요합니다 — 서버가 답하게 하는 키와, 그 답을 열 수 있게 하는 코드.

`nmts login`은 키를 적어 두기 전에 서버에 확인하고, 키의 공개된 손잡이만 찍고 키 자체는 찍지
않으며, 그렇게 하라고 하지 않은 실행은 이미 저장된 키를 덮어쓰지 않습니다. `nmts logout`이 저장된
것을 지웁니다.

**어느 자격도 명령줄 인자로는 받지 않습니다.** 어떤 프로세스든 다른 프로세스의 명령줄을 읽을 수
있고, 셸은 그것을 기록에 남깁니다. 둘 다 그런 옵션이 없습니다.

### 계정 코드를 둘 수 있는 자리

| | 하는 일 | 묻는가 |
|---|---|---|
| `NMTS_ACCOUNT_CODE_FILE=/path` | 파일에서 코드를 읽고, 절대 복사하지 않습니다 | 안 묻습니다 |
| `nmts login` | 암호 문구로 잠가 `~/.nmts/credentials.json`에 둡니다 | 안 묻습니다 |
| `nmts login --plain` | 그대로 씁니다. 파일 모드 600 | 한 번, `unsafe-code-storage` |
| `NMTS_ACCOUNT_CODE`에 코드를 넣기 | 환경에서 바로 씁니다 | 한 번, `plain-env` |

잠근 코드는 명령마다 암호 문구가 필요합니다. 터미널에서 받거나 `NMTS_PASSPHRASE`에서 읽습니다.
여는 데 1초 못 되는 시간과 64 MiB 메모리가 들고, 그것이 암호 문구 추측을 비싸게 만듭니다. 다만
암호 문구는 나와 같은 사용자로 도는 것에서는 코드를 지켜 주지 못합니다. 에이전트가 지켜보는 사람
없이 도는 기계에서는 암호 문구도 손에 닿는 곳에 있어야 하기 때문입니다. 그래서 에이전트에게는
파일 형태를 권합니다 — 코드가 어디에도 복사되지 않고, 권한은 호스트가 정합니다.

환경 변수는 비밀이 아닙니다. `docker inspect`가 통째로 찍고, 나와 같은 사용자로 도는 것은
`/proc/<pid>/environ`을 읽을 수 있고, 모든 자식 프로세스가 물려받고, CI는 로그에 적습니다. 그래서
환경 변수를 쓰면 한 번 묻습니다. `nmts login --env`는 설정할 줄을 찍고 아무것도 쓰지 않으며, 같은
동의 뒤에 있습니다.

**Codex·Hermes·OpenClaw에서는 환경 변수가 MCP 서버에 닿지 않습니다.** 셋 다 MCP 서버를 띄우기
전에 환경을 비웁니다. 대신 `nmts login`으로 저장하거나, 서버 항목의 `env` 블록에 적으십시오.
`nmts env`가 지금 보이는 에이전트의 이름을 말합니다.

## 에이전트에게 건네기 전에

계정 코드는 한 번에 전부입니다. 그것을 가진 프로그램은 모든 파일을 읽고, 올리고, 지우고, 지갑으로
서명할 수 있으며, 그 요청은 내 것과 구별되지 않습니다. 계정을 그대로 둔 채 바꿀 수도 없습니다.
**잃어도 괜찮은 계정을 쓰십시오.**

## 명령

| 명령 | 하는 일 |
|---|---|
| `nmts env` | 이것이 어디서 돌고 있고 그것이 무슨 뜻인지. 아무것도 필요 없음 |
| `nmts login` / `logout` | 이 기계에 계정 코드와 API 키를 두거나 지웁니다 |
| `nmts whoami` | 저장된 코드가 어느 계정의 것인지 — 오프라인 |
| `nmts ls` | 파일 목록 |
| `nmts usage` | 계정이 갖고 있는 것: 개수, 바이트, 가장 큰 파일들, 휴지통 |
| `nmts balance` | 남은 크레딧, 그것으로 살 수 있는 양, 지출 상한 |
| `nmts get <path>` | 파일 하나를 다운로드하고 복호화하고 확인합니다 |
| `nmts pull [folder]` | 폴더 하나 또는 계정 전체를 모양 그대로 다운로드합니다 |
| `nmts put <file>` | 파일 하나를 암호화해 업로드합니다 — **크레딧을 씁니다** |
| `nmts push <directory>` | 디렉터리 하나를 모양 그대로 업로드합니다 — **크레딧을 씁니다** |
| `nmts rm <paths>` | 휴지통으로 옮깁니다 — 30일 동안 되살릴 수 있습니다 |
| `nmts restore <paths>` | 휴지통에서 도로 꺼냅니다 |
| `nmts sweep` | 30일이 지난 휴지통 항목을 버립니다. **되돌릴 수 없어** 실행마다 묻습니다 |
| `nmts mkdir <path>` | 폴더를 만듭니다. 위에 없는 폴더도 함께 |
| `nmts mv <paths> <folder>` | 폴더로 옮깁니다. `/`는 드라이브의 맨 위입니다 |
| `nmts rename <path> <name>` | 하나에 새 이름을 줍니다 |
| `nmts star` / `unstar` | 별을 달거나 뗍니다 |
| `nmts pin` / `unpin` | 폴더 맨 위에 붙들거나 놓아 줍니다 |
| `nmts label <name> <files>` | 파일에 이름표를 붙입니다. `unlabel`이 뗍니다 |
| `nmts on-collision` | 업로드할 이름이 이미 있을 때 무엇을 하는가 |
| `nmts expiring` | 산 저장 기간이 곧 끝나는 파일과 그 시각 |
| `nmts extend <path>` | 파일 하나의 저장 기간을 더 삽니다 — **지갑으로 서명하고 씁니다** |
| `nmts wallet` | 계정의 지갑 주소와 SUI·WAL 잔액. 서명하지 않습니다 |
| `nmts trial` | 이번 주 무료 크레딧이 얼마나 남았는지. `trial apply`가 신청합니다 |
| `nmts create` | 새 계정을 만들고 코드를 한 번 찍습니다. 다시 찍을 수 있는 것은 없습니다 |
| `nmts verify` | 이 계정의 한도를 여는 사람 확인을 부탁합니다 |
| `nmts public-code` | 다른 계정이 파일을 보내는 코드. `--publish`가 받을 수 있게 합니다 |
| `nmts share <path> <address>` | 파일 하나를 다른 계정에 줍니다 — **거둬도 이미 받아 간 사본은 못 되돌립니다** |
| `nmts shares` | 이 계정에 공유된 것 |
| `nmts receive <id>` | 누군가 이 계정에 공유한 파일 하나를 다운로드합니다 |
| `nmts unshare <id>` | 보낸 공유를 거두거나, 받은 공유를 지웁니다 |
| `nmts rebuild` | 목록이 없는 계정에서, 서버의 줄로 파일 목록을 다시 짓습니다 |
| `nmts listfile` | 이 기계가 가진 암호화된 파일 목록을 파일로 씁니다 |
| `nmts recovery-list` | NMTS 없이 이 계정의 바이트를 찾아내는 파일을 씁니다 |
| `nmts kit` | 복구 키트: 그 목록**과 계정 코드**를 한 파일에 |
| `nmts recovery` | NMTS 없이 파일을 되읽는 독립 프로그램을 내려받습니다 |
| `nmts consent` | 이 기계가 무엇에 동의했는지, 그리고 거두기 |
| `nmts mode` | 이 도구를 모는 에이전트가 묻지 않고 얼마나 정할 수 있는가 |
| `nmts update` | 이 도구의 가장 새 릴리스를 설치합니다 |
| `nmts mcp` | 위의 일부를 MCP 도구로 내줍니다 |
| `nmts s3` | 이 기계에서만 닿는 S3 서버로 드라이브를 내줍니다 |

### 목록과 받기

`ls`는 `--json`, `--all`(휴지통 포함 · 몇 개를 숨겼는지는 언제나 말합니다), `--find <text>`(이름에
그 글자가 든 파일과 그것을 담은 폴더만), `--sort name|size|date`, `--desc`를 받습니다.

`get`은 `--out`과 `--force`를 받습니다. 반쯤 맞는 파일을 남기지 않습니다. 바이트는 같은 디렉터리의
임시 이름으로 쓰이고, 파일 전체의 해시가 맞은 뒤에야 제 이름으로 바뀝니다. 메모리에는 파일이
아니라 조각 하나만 올라갑니다. `--out -`는 파일을 쓰는 대신 stdout으로 보내고, 사람이 읽는 것은
전부 stderr로 갑니다. 파이프는 되돌릴 수 없으므로 이 모드는 파일 전체를 먼저 증명하고, 64 MiB를
넘으면 거절합니다.

`pull`은 파일을 하나씩 가져옵니다. 못 가져온 것은 끝에 이름을 대고 나머지는 디스크에 남습니다.
목적지에 이미 있는 파일은 건너뛰고 셉니다. `--force`가 덮어씁니다.

### 올리기

```sh
nmts put report.pdf --dry-run          # 얼마가 드는지. 보내지도 물리지도 않습니다.
nmts put report.pdf --to notes         # 이미 있는 폴더 안으로
nmts put film.mov --part-size 256MiB   # 조각을 키우면: 구매 횟수는 줄고 메모리는 늡니다
```

시작된 메비바이트마다 1크레딧이고, 무엇을 쓰기 전에 값을 찍습니다. 그 폴더에 이미 있는 이름은
`nmts on-collision`이 달리 정하지 않는 한 번호를 단 사본(`report (2).pdf`)이 됩니다. NMTS는 이전
버전을 두지 않으므로 바꿔치기는 영구합니다. 조각 하나(기본 64 MiB)보다 큰 파일은 나뉘고 조각마다
따로 삽니다. 도중에 멈춘 실행은 같은 명령을 다시 돌리면 끝나고, 사지 않은 조각만 삽니다. 어떤
업로드든 끊긴 뒤 다시 돌리면 더 들지 않습니다.

`push`는 디렉터리를 올리고 **첫 실패에서 멈추며**, 이미 올라간 것을 말합니다. 목적지에 같은
이름이 이미 있는 파일은 건너뛰므로 다시 돌려도 안전합니다. 점으로 시작하는 이름은 `--hidden`을
주지 않는 한 건드리지 않고, 심볼릭 링크는 따라가지 않습니다.

### 이름과 폴더와 휴지통

```sh
nmts mkdir photos/2026/august   # 셋 다 없으면 셋 다 만듭니다
nmts mv report.pdf photos       # `/`가 드라이브 맨 위로 되돌립니다
nmts rename report.pdf "q3 report.pdf"
nmts rm photos/2026             # 아래 파일까지 휴지통으로
nmts restore photos/2026
```

어느 것도 값이 들지 않고 묻지 않습니다. 이름, 폴더, 상위 폴더는 암호화된 파일 목록 안에만 있고,
서버에는 이름을 둘 자리가 없습니다. `rm`은 파괴하지 않습니다. 휴지통의 파일마다 제 30일 시계가
있습니다. 영구히 지우는 명령은 이 도구에 일부러 없습니다. 경로는 통째로 맞춥니다(`photos/a.jpg`와
`a.jpg`는 다른 것). 둘에 맞는 경로는 하나를 고르지 않고 거절합니다. `rm`·`restore`·`mv`는 경로
여럿을 한 번의 쓰기로 처리하고, 아무것도 가리키지 않는 경로가 하나라도 있으면 아무것도 건드리기
전에 전체를 멈춥니다.

### 돈과 시간

`balance`는 「무엇을 더 살 수 있는가」에 답합니다 — 남은 크레딧, 그것을 바이트로 바꾼 값, 지출
상한. `usage`는 「무엇을 갖고 있는가」에 답합니다. `expiring`은 저장된 파일이 언제 끝나는지 말합니다.

`extend`는 저장된 파일의 기간을 **계정 코드가 만드는 지갑에서** 공개 체인 위에서 더 삽니다.
기계마다 한 번 `wallet` 동의를 받고, `--dry-run`을 받으며 그때는 열쇠를 건드리지 않습니다.
`wallet`은 읽기만 합니다. 주소는 이 기계에서 만들고, 못 읽은 잔액은 0이 아니라 「못 읽음」으로
말합니다.

### 공유

`share`에는 상대 계정의 공개 코드가 필요하고, 상대는 그것을 자기 계정 화면에서 읽습니다. 이름부도
이름 조회도 없으며, 잘못 친 코드는 그 안의 검사 기호로 걸립니다. 공유를 거두면 그 뒤의 다운로드는
막히지만 이미 받아 간 사본에는 닿지 못합니다. 그래서 처음 공유할 때 동의를 받습니다.

`public-code`는 다른 계정이 파일을 보내는 값을 찍고 공개됐는지 말합니다. 공개하기 전에는 아무도
보낼 수 없습니다. `--publish`가 그것을 영구히 씁니다. 계정 코드에서 나오므로 고를 수도 바꿀 수도
없습니다. 계정 코드가 아니고, 그것만으로는 아무것도 열지 못합니다.

### 복구

`recovery-list`는 저장 네트워크에서 내 바이트가 어디 있는지 찾아내는 암호화된 파일을 씁니다.
계정 코드는 들어 있지 않습니다. `kit`은 그 목록과 계정 코드를 한 파일에 쓰므로, 키트를 가진
사람이 계정을 가집니다. `recovery`는 이 기계에 맞는 독립 복구 프로그램을 내려받아 릴리스의
체크섬 파일과 대조한 뒤에야 실행 가능하게 만들고, PATH에는 아무것도 넣지 않습니다. `rebuild`는
목록을 잃은 계정의 파일 목록을 서버의 줄로 다시 짓습니다. 열쇠·해시·날짜·크기는 돌아오고 이름과
폴더는 돌아오지 않습니다.

### 사람이 지나야 하는 확인

API 키는 서버가 답하게 할 뿐, 사람이 있다는 것을 대신하지 못합니다. 최근에 아무도 확인하지
않았으면 계정은 더 좁은 한도 안에서 돌고, 몇 가지 요청은 거절됩니다.

```sh
nmts verify --status   # 확인이 살아 있는지, 언제까지인지
nmts verify            # 사람이 nmts.me에 칠 짧은 코드를 찍고 기다립니다
```

도구도 에이전트도 이 확인을 대신 지날 수 없습니다. 며칠이 아니라 확인이 **끝나는 시각**을 찍는
이유는, 그 창이 서버 자신의 주 단위 경계에서 닫히기 때문입니다.

## 멈춰 서서 묻는 것

기계마다 한 번, 다섯 가지: **크레딧 쓰기**, **계정 코드를 잠그지 않고 저장하기**, **환경 변수에서
바로 쓰기**, **다른 계정에 내 파일 주기**, **지갑으로 서명하기**. 각각 무슨 일이 일어나는지, 무엇이
잘못될 수 있는지, 동의하는 한 명령을 찍습니다. `nmts sweep`은 대신 실행마다 묻습니다. 그 파일들에
대한 이 계정의 열쇠 사본을 없애기 때문입니다. 목록·다운로드·이름 바꾸기·옮기기는 누구에게도 멈추지
않습니다. `nmts consent`가 무엇에 동의했는지 보여 주고 거둘 수 있습니다.

## 컨테이너

Docker와 Podman에서 rootless로 그대로 돕니다. 공개된 이미지는 없고, 이 저장소에 `Dockerfile`이
있으며, 두 컨테이너 도구가 푸시마다 그것을 굽고 돌립니다.

```sh
docker build -t nmts .        # 또는: podman build -t nmts .
docker run --rm nmts --version
```

이미지는 보통 사용자로 돌고 스스로 만드는 `/config`에 쓰므로, 거기에 볼륨을 붙이면 됩니다. 자격은
파일로 주고, 컨테이너 안에서는 절대 환경 변수로 주지 마십시오.

```sh
printf '%s' "$CODE" > /tmp/nmts-code && chmod 600 /tmp/nmts-code
printf '%s' "$KEY"  > /tmp/nmts-key  && chmod 600 /tmp/nmts-key
docker run --rm \
  -v /tmp/nmts-code:/run/secrets/nmts:ro \
  -v /tmp/nmts-key:/run/secrets/api-key:ro \
  -e NMTS_ACCOUNT_CODE_FILE=/run/secrets/nmts \
  -e NMTS_API_KEY_FILE=/run/secrets/api-key \
  nmts ls
```

이름은 댔는데 없는 자격 파일은 어떤 요청보다 먼저 멈춥니다(종료 코드 3).

동의는 설정 디렉터리에 있고, 지워진 컨테이너는 그것을 함께 가져가므로, 새 컨테이너는 목록과
다운로드는 되지만 업로드는 거절합니다. 동의를 이미지에 굽거나(`RUN nmts consent grant spend`)
설정 디렉터리를 컨테이너 밖에 두십시오(`-v nmts-config:/config`). 직접 만든 이미지에서는
`NMTS_CONFIG_DIR`이 이 도구가 쓰는 모든 것을 고른 디렉터리로 옮기고, `nmts env`가 어디에
놓였는지와 살아남는지를 말합니다.

## S3 도구에 드라이브 내주기

`nmts s3`는 이 기계에서 S3 프로토콜을 말하는 서버를 띄웁니다. rclone, AWS CLI, S3를 아는 어떤
백업 프로그램이든 이 계정의 파일을 목록으로 보고 내려받을 수 있습니다.

```
$ nmts s3
  This account's drive is being served at http://127.0.0.1:9000, to this machine only.
  endpoint        http://127.0.0.1:9000
  bucket          drive
  access key id   NMTS…
  secret key      …
```

- 버킷은 `drive` 하나. 키는 앞 슬래시를 뺀 파일 경로입니다. 폴더는 빈 것까지 common prefix로
  돌아옵니다.
- 자격은 명령이 시작될 때 만들어지고, 어디에도 저장되지 않으며, 명령과 함께 죽습니다.
- 127.0.0.1에만 귀를 기울이고, 바꾸는 옵션은 없습니다.
- 업로드와 삭제에는 크레딧 동의가 필요합니다. 없으면 드라이브를 읽기 전용으로 내주고 모든 쓰기를
  그 이유를 말하는 문장과 함께 거절합니다. 삭제는 파일을 휴지통에 넣습니다.
- 이미 **같은** 파일을 가진 키에는 `200`으로 답하고 아무것도 보내지 않습니다. 이름이 아니라 내용을
  비교하므로, 밤마다 도는 백업은 바뀐 파일 값만 냅니다. **다른** 파일을 가진 키는 `409`로
  거절합니다. 이 드라이브는 파일을 바꿔치기하지 않기 때문입니다.
- 큰 파일은 조각으로 올라오고, 클라이언트가 서명한 해시와 조각마다 대조합니다. 모든 조각이 들어오기
  전에는 아무것도 저장되지 않습니다.
- 수정 시각은 옮겨지지 않고, 다른 기기에서 올린 파일은 보이기까지 5초가 걸릴 수 있습니다.

rclone이라면:

```
$ rclone config create drive s3 provider=Other region=us-east-1 \
    endpoint=http://127.0.0.1:9000 \
    access_key_id=<위에 찍힌 id> secret_access_key=<위에 찍힌 secret>
$ rclone lsf -R drive:drive
$ rclone copy drive:drive ./somewhere
$ rclone copy --size-only ./somewhere drive:drive
```

## MCP를 말하는 에이전트에게

`nmts mcp`는 stdin과 stdout 위의 로컬 MCP 서버입니다. 먼저 로그인하십시오(`nmts login`). 명령줄로
코드를 받지 않고, 묻지도 않으므로, 잠근 코드에 `NMTS_PASSPHRASE`가 없으면 시작하자마자 종료
코드 3으로 끝납니다.

```
$ claude   mcp add nmts -- nmts mcp --out /where/files/should/land
$ codex    mcp add nmts -- nmts mcp --out /where/files/should/land
$ opencode mcp add nmts -- nmts mcp --out /where/files/should/land
```

Hermes와 OpenClaw는 인자를 하나씩 넘깁니다(Hermes는 `--args`, OpenClaw는 `--arg` 반복). 각자의
`mcp add --help`가 모양을 찍습니다. 다른 클라이언트도 명령 `nmts`와 인자 `mcp --out <directory>`를
받으면 됩니다. 예를 들어 opencode의 설정 파일이라면:

```json
{ "mcp": { "nmts": { "type": "local", "command": ["nmts", "mcp", "--out", "/where/files/should/land"] } } }
```

도구 스무 개를 내줍니다. 계정 읽기(`nmts_whoami`, `nmts_list`, `nmts_usage`, `nmts_expiring`,
`nmts_balance`, `nmts_shares`), 받기(`nmts_get`, `nmts_pull`, `nmts_receive`), 올리기(`nmts_put`,
`nmts_push`), 정리(`nmts_mkdir`, `nmts_move`, `nmts_rename`, `nmts_mark`, `nmts_trash`,
`nmts_restore`), 공유(`nmts_public_code`, `nmts_share`, `nmts_unshare`).

자격과 동의, 사람이 지나야 하는 확인, 영구 삭제, 잃은 파일 목록 다시 짓기, 복구 파일 쓰기는
일부러 내주지 않습니다. 그것은 사람의 몫입니다. 내주는 어떤 도구도 지정한 디렉터리 밖에는 쓰지
못하고, 잘못된 인자는 짐작하지 않고 거절합니다. MCP SDK 없이 직접 구현해 의존성이 없습니다.

## 에이전트가 스스로 판단하게 두기

기본으로 이 도구는 아직 동의하지 않은 일 앞에서 사람에게 묻고, 이 도구를 모는 에이전트는 대신
답하지 말라는 지시를 받습니다.

```
$ nmts mode                                        # 지금 무엇이 켜져 있는가
$ nmts mode auto --i-accept-the-risk               # 에이전트가 판단하고 진행합니다
$ nmts mode skip-permissions --i-accept-the-risk   # 에이전트가 진행합니다
$ nmts mode off                                    # 다시 묻습니다
```

하나가 켜져 있는 동안 모든 명령이 stderr에 그렇다고 말합니다. 동의는 여전히 날짜와 함께 하나씩
기록됩니다. 달라지는 것은 에이전트가 사람 대신 그것을 기록해도 된다는 점입니다.

## 네트워크와 재시도

`--network mainnet` 또는 `--network testnet`, 또는 `NMTS_NETWORK`. 실서버에서는 이미 알고
있고, 다른 서버에서는 필수입니다. 틀린 네트워크는 「틀린 네트워크」가 아니라 「없음」이라고 답하기
때문입니다.

거절되거나 끊기거나 아예 맺어지지 않은 연결은 점점 길어지는 대기와 함께 20초쯤 다시 시도하고,
대기는 알립니다. 서버의 거절, 30초를 다 쓴 요청, 멱등성 키가 없는 쓰기는 다시 시도하지 않습니다.
값을 치르는 두 호출은 그 키를 실어 다시 보내도 안전하고, 그 밖에 쓰는 것은 그렇지 않습니다.

## 뭔가 잘못됐다면

**nmts@nmts.me**로 쓰십시오 — 고장, 헷갈리는 문장, 없는 기능, 걸리적거린 무엇이든. 무엇을
돌렸고 무엇이 찍혔는지 적어 주십시오. 서비스 자체에 대한 질문과 내용에 대한 신고는
[nmts.me](https://nmts.me)의 문의 창구로 갑니다.

## 이 위에 만드셨습니까?

이 코드 위에 무엇을 만드셨다면 — 서비스, 포크, 다른 언어로의 이식, 더 가벼운 클라이언트 —
저희에게 갚을 것은 없습니다. Apache-2.0은 고지 외에 아무것도 요구하지 않습니다. 그래도 알고
싶습니다. **nmts@nmts.me**로 쓰시거나, 공개돼도 괜찮다면 여기 이슈를 여십시오. 목록에 싣고
싶으시면 그렇게 말씀해 주십시오. [SHOWCASE.ko.md](SHOWCASE.ko.md)에 프로젝트마다 링크와 열 줄까지의
소개를 만든 분이 쓴 대로 싣습니다(영어 목록은 [SHOWCASE.md](SHOWCASE.md)). 목록에 실리는 것은 보증이 아니며, 저희는
이유를 밝히지 않고 싣지 않거나 내릴 수 있습니다.

## 라이선스

Apache-2.0 — 전문은 [LICENSE](LICENSE)에 있습니다. 2026-08-30에 AGPL-3.0-only에서 옮겨 왔고,
그 전에 AGPL로 받은 사본은 그대로 AGPL입니다.

그 위에 만들고, 내보내고, 만든 것을 파십시오. 다른 조건이 필요하면 **nmts@nmts.me**로 이유를
적어 보내십시오 — [LICENSING.md](LICENSING.md). 코드는 환영합니다.
[CONTRIBUTING.ko.md](CONTRIBUTING.ko.md)가 어떻게 여기 닿는지 말하고, [기여자 동의서](CLA.ko.md)가
위의 제안을 프로그램 전체에 대해 참으로 유지합니다.

Copyright © 2026 needmoretruth.
