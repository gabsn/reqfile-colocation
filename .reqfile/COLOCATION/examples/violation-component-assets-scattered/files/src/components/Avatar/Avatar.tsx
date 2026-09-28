import "../../styles/avatar.css";

export function Avatar({ name, url }: { name: string; url: string }) {
  return <img className="avatar" src={url} alt={name} />;
}
