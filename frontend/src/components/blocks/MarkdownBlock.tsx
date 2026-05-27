import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useNavigate } from "react-router-dom";
import type { Components } from "react-markdown";

function useMarkdownComponents(): Components {
  const navigate = useNavigate();
  return {
    a({ href, children, ...props }) {
      if (!href) return <a {...props}>{children}</a>;
      // Relative .md links → navigate to /plans/<name> inside the app
      if (!href.startsWith("http://") && !href.startsWith("https://") && !href.startsWith("/")) {
        const name = href.replace(/\.md$/, "");
        return (
          <a
            {...props}
            href={`/plans/${encodeURIComponent(href)}`}
            onClick={(e) => { e.preventDefault(); navigate(`/plans/${encodeURIComponent(name)}`); }}
            className="text-orange-600 hover:underline cursor-pointer"
          >
            {children}
          </a>
        );
      }
      // External links → open in new tab
      return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
    },
  };
}

export default function MarkdownBlock({ text }: { text: string }) {
  const components = useMarkdownComponents();
  return (
    <div className="markdown text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
