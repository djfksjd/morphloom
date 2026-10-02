# Part PBR scalar 비파괴 편집 계약

2026-10-02. 첫15분·같은 결함2회 후 재진단. 실제0.6 기어 UI에서 roughness를0.32→0.52로 변경하고 Apply/Save하자 material.surface가 사라지는 실패를 재현했다. baseline source·geometry fingerprints와실제saved IR을outputs/part-material-preservation-20261002에 보존했다.

수정은 PartInspector 두scalar handler가 다른material fields를 유지하도록 제한한다. editPart의 기존 replacement semantics와source schema0.6은 변경하지 않는다. surface.finish/channels/repeat·반대scalar·geometry/UV/datums/계층/비대상재질을 보존한다. roughness 또는metalness 변경은 해당PBRfactor와engine의기존bitmap생성 규칙에만 영향을 준다;생성appearance와실측물성은 구분한다.

합격:실제stage/cancel/apply/undo/redo/save/reopen,roughness와metalness각각,actualGLB embeddedmap·repeat8·선언형surface·PBRfactor·geometry/UV/non-target보존,Blenderactualreopen/pixels,currenthash·관련check/tests/build. 기존UV/production/standard/20MBgate는그대로. 필요없는전체renderer교체·새의존성/API/원자료외부전송없음. 의미있는완료체크포인트에서만push한다.
