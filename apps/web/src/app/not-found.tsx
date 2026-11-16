import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { BookIcon } from "@/components/icons";
import { ButtonLink, Container } from "@/components/ui";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className="flex min-h-[60vh] flex-col justify-center py-16">
          <p className="font-mono text-xs tracking-[0.08em] text-deny">■ 404 · NO ROUTE</p>
          <h1 className="mt-4 text-4xl font-medium tracking-[-0.03em] text-fg">This page does not exist.</h1>
          <div className="mt-8">
            <ButtonLink href="/docs" icon={<BookIcon size={17} />}>Docs</ButtonLink>
          </div>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
