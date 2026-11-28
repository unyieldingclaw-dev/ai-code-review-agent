#!/bin/sh
# The caller supplies an independently selected host Python installation. Never probe PATH.
repo=
want_repo=0
for arg do
    if [ "$want_repo" = 1 ]; then
        repo=$arg
        want_repo=0
    else
        case $arg in
            --repo) [ -z "$repo" ] || exit 3; want_repo=1 ;;
            --repo=*) [ -z "$repo" ] || exit 3; repo=${arg#--repo=} ;;
        esac
    fi
done
python=${PMB_SNAPSHOT_PYTHON-}
for path in "$repo" "$python"; do
    case $path in /*|[A-Za-z]:[\\/]* ) ;; *) exit 3 ;; esac
done
script=$(/usr/bin/realpath "$0") || exit 3
cd -P -- "${script%/*}" || exit 3
# The system (Git for Windows on MSYS) utility is selected before any PATH lookup.
repo=$(/usr/bin/realpath "$repo") || exit 3
python=$(/usr/bin/realpath "$python") || exit 3
case $repo in /|[A-Za-z]:/) exit 3 ;; esac
[ -d "$repo" ] && [ ! "$repo" -ef / ] && [ -f "$python" ] && [ -x "$python" ] || exit 3
ancestor=$python
while [ -n "$ancestor" ]; do
    [ "$ancestor" -ef "$repo" ] && exit 3
    case $ancestor in
        */*) ancestor=${ancestor%/*} ;;
        *) break ;;
    esac
done
exec "$python" -I -B ./_secret-snapshot.py "$@"
