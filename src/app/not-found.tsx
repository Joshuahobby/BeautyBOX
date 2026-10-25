import { ButtonLink } from "@/components/ui/Button";
import { messages } from "@/messages";

export default function NotFound() {
  return (
    <div className="container page u-max-712">
      <div className="stack-4">
        <h1 className="page-title">{messages.errors.notFoundTitle}</h1>
        <p>{messages.errors.notFoundBody}</p>
        <ButtonLink href="/shop">{messages.home.shopProducts}</ButtonLink>
      </div>
    </div>
  );
}
