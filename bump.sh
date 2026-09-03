#!/usr/bin/env bash
# 데이터 파일(copy.js·scholars.js·config.js) 내용이 바뀌면 script 태그에 해시를 박아
# 브라우저가 옛 파일을 캐시해서 쓰는 문제를 막는다. 배포 전에 실행할 것.
set -e
cd "$(dirname "$0")"
for f in copy.js scholars.js scholars_all.js consulting.js config.js manual.js schedule-cal.js course-cal.js academic.js ops-cal.js consult-slots.js; do
  [ -f "$f" ] || continue
  h=$(sha1sum "$f" | cut -c1-8)
  for page in admin.html landing.html input.html control.html planner.html booking.html; do
    [ -f "$page" ] || continue
    # src="copy.js" 또는 src="copy.js?v=xxxx" → src="copy.js?v=<해시>"
    sed -i -E "s|src=\"$f(\?v=[a-f0-9]+)?\"|src=\"$f?v=$h\"|g" "$page"
  done
  echo "$f -> v=$h"
done
