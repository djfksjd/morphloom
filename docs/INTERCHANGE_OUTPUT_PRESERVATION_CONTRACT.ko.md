# Interchange repair 출력 보존 계약 — 2026-10-04

기반bd2f573. 동일 입력에서 기하·UV·normal·재질 recovery 결과와 기존 검사 임계값은 변경하지 않는다. 이번 결함은 보고서 경로가 입력/material source와 같을 때 원본을 덮어쓰거나, 보고서 저장 실패 뒤 일부 GLB가 남는 CLI 동작이다.

출력과 선택적 receipt는 새 파일만 허용한다. 기존 파일·symlink·입력 alias는 거부한다. canonical parent를 기준으로 출력 경로 중복도 거부한다. 검증 완료 후 exclusive open으로 기록하고, 다음 기록이 실패하면 이 실행이 만든 파일만 제거한다. 다른 프로세스가 만든 파일을 덮어쓰거나 제거하지 않는다. 실패 시 입력 두 개의 SHA와 기존 출력의 bytes는 그대로 유지되어야 한다.

fixture의 실제 광학 PBR 복원·UV·normal 보존 테스트를 재사용한다. 추가 실패 사례는 report=input, report=material source, report=output, 기존 output/receipt, symlink alias, 없는 receipt parent다. local Node/Blender 실행만 사용하며 외부 API0. 전체 test/check/benchmark/build 및 현재 quality 게이트를 기록한다. 모든 플랫폼 납품 완료나 cooling UV 알림 해결로 보고하지 않는다.
