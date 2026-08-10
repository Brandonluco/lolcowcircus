function getStreamers() {

   let saved = localStorage.getItem("streamers");

   if (saved) {
       return JSON.parse(saved);
   }

   localStorage.setItem(
       "streamers",
       JSON.stringify(defaultStreamers)
   );

   return defaultStreamers;

}


function saveStreamers(streamerData) {

    localStorage.setItem(
        "streamers",
        JSON.stringify(streamerData)
    );

}


async function saveAlert(alertData) {

    await fetch("/api/alert", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(alertData)
    });

}

function getArticles() {

    let saved = localStorage.getItem("articles");

    if (saved) {
        return JSON.parse(saved);
    }

    localStorage.setItem(
        "articles",
        JSON.stringify(articles)
    );

    return articles;

}


function saveArticles(articleData) {

    localStorage.setItem(
        "articles",
        JSON.stringify(articleData)
    );

}

const articles = [
    {
        title: "Welcome To UndergroundCowTube",
        date: "August 2, 2026",

        contentTop: "Welcome to the first article on UndergroundCowTube. This is where community updates and archive posts will appear.",

        image: "",

        youtube: "https://www.youtube.com/watch?v=7AZddEM6aVA",

        contentBottom: "More updates and community news will be posted here."
    }
];