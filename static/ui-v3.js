document.addEventListener("DOMContentLoaded", () => {
  if (document.body.dataset.page === "auth") return;
  const current = location.pathname.split("/").pop() || "index.html";
  const tabs = [
    ["index.html","Home","⌂"],
    ["chat.html","Chat","◫"],
    ["creatives.html","Library","▤"],
    ["ads.html","Ads","◎"],
    ["brands.html","Brands","◇"]
  ];
  if (!document.querySelector(".mobile-tabs")) {
    const nav = document.createElement("nav");
    nav.className = "mobile-tabs";
    nav.setAttribute("aria-label","Primary navigation");
    nav.innerHTML = tabs.map(([href,label,icon]) =>
      '<a href="' + href + '" class="' + (href === current ? 'active' : '') + '">' +
      '<span class="ico">' + icon + '</span><span>' + label + '</span></a>'
    ).join("");
    document.body.appendChild(nav);
  }
});