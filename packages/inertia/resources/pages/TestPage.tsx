// Test fixture for inertia coverage tests
export default function TestPage(props: Record<string, unknown>) {
  return <div id="test-page">{String(props.title ?? "Test")}</div>;
}
