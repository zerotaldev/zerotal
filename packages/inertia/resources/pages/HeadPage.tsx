// Test fixture: a page that sets its own head, the way a real one does.
//
// The point of the fixture is the `<Head>` import — it renders nothing itself and
// reports to a head manager it reads from context, so a server render that does not
// install one drops every tag here without failing.
import { Head } from "@inertiajs/react";

export default function HeadPage(props: Record<string, unknown>) {
  const title = String(props.title ?? "Untitled");
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content="A page that describes itself." />
        <meta property="og:title" content={title} />
      </Head>
      <div id="head-page">{title}</div>
    </>
  );
}
