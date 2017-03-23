function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
}

var urls = ["http://www.princeton.edu/main/",
            "http://www.columbia.edu/",
            "http://www.upenn.edu/",
            "http://www.brown.edu/",
            "http://dartmouth.edu/",
            "http://www.harvard.edu",
            "http://www.yale.edu",
            "http://www.omfgdogs.com"];


window.location = urls[getRandomInt(0,7)];
