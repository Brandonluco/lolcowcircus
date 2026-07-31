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