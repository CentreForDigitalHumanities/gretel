/**
 * jQuery "plug-in" to convert an XML tree structure into a
 * plug-and-play HTML tree that allows user interaction.
 *
 * https://github.com/BramVanroy/tree-visualizer
 *
 * @version 0.3
 * @license MIT
 * @author Bram Vanroy (modified by Sheean Spoel)
 */
var jQuery = require('jquery');

(function ($) {
    $.fn.treeVisualizer = function (xml, options) {
        var defaults = {
            normalView: true,
            sentence: '',
            initFSOnClick: false,
            extendedPOS: false,
            hasNavigation: false,
            showMatrixDetails: false
        };
        var args = $.extend({}, defaults, options);
        var instance = this,
            FS, NS,
            treeFS, treeNS, tooltipFS, tooltipNS,
            anyTree,
            anyTooltip,
            zoomOpts, tooltipTimeout;
        var $window = $(window),
            $body = $("body");
        initVars();
        parseXMLObj(xml);
        navigationDisabler();
        // Window event only need to be bound once
        $window.on("scroll", function () {
            tooltipPosition();
        });

        function bindInitEvents() {
            if (!args.initFSOnClick) {
                // Show tree-visualizer-fs tree
                instance.find(".tv-show-fs").on("click", function (e) {
                    instance.trigger('open-fullscreen');

                    e.preventDefault();
                });
            }
            // Adjust scroll position
            anyTree.on("scroll", function () {
                tooltipPosition();
            });

            // Close fullscreen if a user clicks on an empty area
            FS.on("click", function (e) {
                var target = $(e.target);
                if (!target.closest(".tv-error, .tv-content-wrapper").length) {
                    closeFullscreen();
                }
            });
            // Zooming
            zoomOpts.find("button").on("click", function () {
                var $this = $(this);
                clearTimeout(tooltipTimeout);
                fontSizeTreeFS($this.attr("class").match(/\b(zoom-[^\s]+)\b/)[0]);

                var animationSpeed = treeFS.find("a.hovered").css("transition-duration") || 200;
                animationSpeed = (String(animationSpeed).indexOf("ms") > -1) ? parseFloat(animationSpeed) : (parseFloat(animationSpeed) * 1000);
                animationSpeed += 50;

                tooltipTimeout = setTimeout(function () {
                    tooltipPosition(true);
                }, animationSpeed);
            });
            // Close button
            instance.find(".tv-close-fs").on('click', function () {
                closeFullscreen();
            });

            FS.find(".tv-navigation-wrapper button").on("click", function () {

                var index = FS.attr("data-tv-active-index"),
                    resultsTable = $(".results-ajax-wrapper tbody:not(.empty)");

                treeFS.find("a").removeClass("hovered");
                tooltipFS.hide();

                if ($(this).is(".tv-prev-tree")) {
                    if (index > 0) index--;
                } else {
                    if (index < resultsTable.find("tr").length - 1) index++;
                }

                navigationDisabler();

                resultsTable.find("tr").eq(index).find("a").click();
            });

            anyTree.on("click", "a", function (e) {
                if (!$(this).hasClass("ignored")) {
                    var $this = $(this),
                        data = $this.parent("li").data(),
                        tree = $this.closest(".tv-tree"),
                        tooltipList = tree.next(".tv-tooltip").children("ul"),
                        i;

                    instance.trigger('node-selected', [data]);

                    tooltipList.empty();
                    tree.find("a").removeClass("hovered");

                    if ($this.is(".selected")) {
                        // when the node has been selected, only unselect it
                        tooltipFS.hide();
                    } else {
                        $this.addClass("hovered");

                        for (i in data) {
                            if (data.hasOwnProperty(i) && i != 'uiDraggable') {
                                $("<li>", {
                                    html: "<strong>" + i + "</strong>: " + data[i]
                                }).prependTo(tooltipList);
                            }
                        }
                        tooltipPosition();
                    }
                }

                e.preventDefault();
            });

            anyTree.on("mouseout", "a.hovered", function () {
                if ($(this).closest(".tv-tree").hasClass("small")) {
                    $(this).on("transitionend", function () {
                        tooltipPosition(true);
                    });
                }
            });

            function hideTooltip() {
                anyTooltip.fadeOut(250);
                anyTree.find("a").removeClass("hovered");
            }

            $body.on("click", function (event) {
                if (!$(event.target).closest('a,.tv-tooltip').length) {
                  // clicked somewhere except on the tooltip itself or
                  // a (node) link
                  hideTooltip();
                }
            });
            anyTooltip.children("button").on("click", hideTooltip);
        }

        function navigationDisabler() {
            FS.find(".tv-navigation-wrapper button").prop("disabled", false);
            var index = FS.attr("data-tv-active-index");
            if (index <= 0) {
                FS.find(".tv-navigation-wrapper .tv-prev-tree").prop("disabled", true);
            } else if (index >= $(".results-ajax-wrapper tbody:not(.empty)").find("tr").length - 1) {
                FS.find(".tv-navigation-wrapper .tv-next-tree").prop("disabled", true);
            }
        }

        function initVars() {
            var trees = [],
                tooltips = [],
                screens = [];

            if (args.normalView) {
                NS = instance.children(".tree-visualizer");

                treeNS = NS.find(".tv-tree");
                tooltipNS = treeNS.next(".tv-tooltip");

                screens.push(NS);
                trees.push(treeNS);
                tooltips.push(tooltipNS);
            }

            FS = instance.children(".tree-visualizer-fs");

            treeFS = FS.find(".tv-tree");
            tooltipFS = treeFS.next(".tv-tooltip");
            zoomOpts = FS.find(".tv-zoom-opts");

            screens.push(FS);
            trees.push(treeFS);
            tooltips.push(tooltipFS);

            anyTree = jqArrayToJqObject(trees);
            anyTooltip = jqArrayToJqObject(tooltips);
            var anyView = jqArrayToJqObject(screens);

            var errorContainer = anyView.children(".tv-error");

            if (args.sentence != "") {
                anyView.find(".tv-sentence-wrapper").addClass("has-sentence").children("span").html(args.sentence);
            }

            if (!args.hasNavigation) {
                FS.find(".tv-navigation-wrapper").hide();
            }
            anyView.find("*").off();
            bindInitEvents();
        }

        function parseXMLObj(xml) {
            var xmlObject = $($.parseXML(xml));

            removeError();

            // See the buildOutputList function below
            anyTree.html(buildOutputList(xmlObject.find("node").addBack('node').first()));
            // Empty tooltips
            anyTooltip.children("ul").empty();

            // Do some small tree modifications
            treeModifier();

            if (args.normalView) {
                $body.addClass("tv-ns-open");
            }
            if (args.initFSOnClick) {
                FS.fadeIn(250, function () {
                    fontToFit();
                });
            }
        }

        instance.on('open-fullscreen', openFullscreen);

        function openFullscreen() {
            anyTooltip.hide().children("ul").empty();
            if (typeof treeNS != "undefined") treeNS.find("a").removeClass("hovered");
            $body.addClass("tv-fs-open");
            FS.fadeIn(250, function () {
                if (!FS.children("ol").is("[data-tv-fontsize]")) {
                    fontToFit();
                }
            });
        }

        instance.on('close-fullscreen', closeFullscreen);

        function closeFullscreen() {
            instance.trigger('close');
            $body.removeClass("tv-fs-open");
            FS.fadeOut(250, function () {
                treeFS.find("a").removeClass("hovered");
                removeError();
            });
            if (args.initFSOnClick) history.replaceState("", document.title, window.location.pathname + window.location.search);
        }

        instance.on('select-nodes', selectNodes);

        function selectNodes(event, selectedNodes) {
            $('.tree-visualizer li[data-varname] a.selected').removeClass('selected');
            for (var i in selectedNodes) {
                var node = selectedNodes[i];
                $('.tree-visualizer li[data-varname="' + node + '"] > a').addClass('selected');
            }
        }

        // Build the HTML list output
        function buildOutputList(nodes) {
            var newList = $("<ol/>");

            nodes.each(function (x, e) {
                var newItem = $('<li><a href="#"></a></li>');

                for (var i = 0, l = e.attributes.length, a = null; i < l; i++) {
                    // Don't forget to add properties as data-attributes
                    a = e.attributes[i];
                    // Some data-attributes have initial spaces. Get rid of them
                    if (a.nodeName == "highlight") {
                        newItem.addClass("highlight");
                    } else if (a.nodeName == "not") {
                        newItem.addClass("excluded");
                    } else if (a.nodeName != "begin" && a.nodeName != "end") {
                        newItem.attr("data-" + a.nodeName, a.value.replace(/^\s(.+)/, "$1"));
                    }
                }
                if ($(this).children("node").length) {
                    newItem.append(buildOutputList($(this).children("node")));
                }
                newList.append(newItem);
            });
            return newList;
        }

        // Small modifications to the tree
        // Only add certain things (e.g. CS) on the matrix page
        function treeModifier() {
            anyTree.find("a").each(function () {
                var $this = $(this),
                    li = $this.parent("li");

                const excluded = (li.data("exclude") || "").split(",");
                function checkExclude(attr) {
                    if (excluded.indexOf(attr) >= 0) {
                        return ' excluded ';
                    }

                    return '';
                }

                if (args.showMatrixDetails && li.data("word")) {
                    if (li.data("caseinsensitive")) {
                        const word = li.data("word");
                        if (word) {
                            li.data("word", word.toLowerCase());
                        }
                        const lemma = li.data("lema");
                        if (lemma) {
                            li.data("lemma", lemma.toLowerCase());
                        }
                    } else {
                        $this.addClass("cs");
                    }
                }

                if (li.data("rel")) {
                    $this.append(`<span class='rel ${checkExclude('rel')}'>` + li.data("rel") + "</span>");
                    if (li.data("index")) $this.append("<span class='index'>" + li.data("index") + "</span>");
                }

                if (li.data("postag") && args.extendedPOS) {
                    $this.append(`<span class='postag ${checkExclude('postag')}'>` + li.data("postag") + "</span>");
                } else if (li.data("pt")) {
                    if (li.data("index")) $this.children("span:last-child").append(":" + li.data("pt"));
                    else $this.append(`<span class='pt ${checkExclude('pt')}'>` + li.data("pt") + "</span>");
                } else if (li.data("cat")) {
                    if (li.data("cat") == " ") {
                        li.removeAttr("data-cat");
                        li.removeData("cat");
                        $this.addClass("ignored").text("?").attr("title", "Top node's properties will be ignored");
                    } else {
                        if (li.data("index")) $this.children("span:last-child").append(":" + li.data("cat"));
                        else $this.append(`<span class='cat ${checkExclude('cat')}'>` + li.data("cat") + "</span>");
                    }
                } else if (li.data("pos")) {
                    if (li.data("index")) $this.children("span:last-child").append(":" + li.data("pos"));
                    else $this.append(`<span class="${checkExclude('pos')}">` + li.data("pos") + "</span>");
                } else if (!li.data("rel")) {
                    // nothing specified, set something from the query
                    // (when doing a custom xpath query)
                    let keys = Object.keys(li.data());
                    let key = null;
                    for (let i in keys) {
                        key = keys[i];
                        if (key == 'varname') {
                            key = null;
                        } else {
                            break;
                        }
                    }

                    $this.append(`<em class="${checkExclude(key)}">${(key && li.data()[key]) || 'node'}</em>`);
                }

                if ($this.is(":only-child")) {
                    if (li.data("lemma")) li.append(`<span class='lemma ${checkExclude('lemma')}'>` + li.data("lemma") + "</span>");
                    if (li.data("word")) {
                        var csTitle = (args.showMatrixDetails && !li.data("caseinsensitive")) ? 'data-balloon-pos="down" aria-label="Case sensitive word"' : '';
                        li.append(`<span class='word ${checkExclude('word')}'><em ` + csTitle + ">" + li.data("word") + "</em></span>");
                    }
                    // addClass because after appending new children, it isn't necessarily the
                    // only child any longer
                    $this.addClass("only-child");
                }


                if (li.data("caseinsensitive")) {
                    li.removeAttr("data-caseinsensitive");
                    li.removeData("caseinsensitive");
                }
            });

            anyTree.find("li:only-child").addClass("only-child");
            anyTree.find("li:first-child").addClass("first-child");
            anyTree.find("li:last-child").addClass("last-child");
        }

        function noMoreZooming() {
            var currentFontSize = parseInt(treeFS.children("ol").css("fontSize"), 10),
                fitSize = treeFS.children("ol").attr("data-tv-fontsize");

            zoomOpts.find("button").prop("disabled", false);
            treeFS.removeClass("tv-small tv-x-small");

            if (currentFontSize <= 4) {
                zoomOpts.find("button.tv-zoom-out").prop("disabled", true);
                treeFS.children("ol").css("fontSize", "4px");
            } else if (currentFontSize >= 16) {
                zoomOpts.find("button.tv-zoom-in").prop("disabled", true);
            }

            if (currentFontSize == fitSize) {
                zoomOpts.find("button.tv-zoom-default").prop("disabled", true);
            }

            if (currentFontSize <= 8) {
                treeFS.addClass("tv-small");
                if (currentFontSize <= 4) {
                    treeFS.addClass("tv-x-small");
                }
            }
        }

        function fontSizeTreeFS(mode) {
            if (mode == 'zoom-default') {
                if (treeFS.children("ol").is("[data-tv-fontsize]")) {
                    treeFS.children("ol").css("fontSize", treeFS.children("ol").attr("data-tv-fontsize") + "px");
                } else {
                    fontToFit();
                }
            } else {
                var currentFontSize = parseInt(treeFS.children("ol").css("fontSize"), 10);
                if (mode == 'zoom-in') {
                    treeFS.children("ol").css("fontSize", currentFontSize + 2 + "px");
                } else if (mode == 'zoom-out') {
                    treeFS.children("ol").css("fontSize", currentFontSize - 2 + "px");
                }
            }
            noMoreZooming();
        }

        function fontToFit() {
            var fontFitSize = parseInt(treeFS.children("ol").css("fontSize"), 10),
                el = treeFS[0];

            while (fontFitSize > 4 && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) {
                fontFitSize--;
                treeFS.children("ol").css("fontSize", fontFitSize + "px");
            }

            while (fontFitSize < 16 && el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) {
                fontFitSize++;
                treeFS.children("ol").css("fontSize", fontFitSize + "px");

                if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) {
                    fontFitSize--;
                    treeFS.children("ol").css("fontSize", fontFitSize + "px");
                    break;
                }
            }
            treeFS.children("ol").attr("data-tv-fontsize", fontFitSize);
            noMoreZooming();
        }

        function tooltipPosition(animate) {
            var tree;

            if (typeof treeFS != "undefined" && $body.hasClass("tv-fs-open")) {
                tree = treeFS;
            } else if (typeof treeNS != "undefined" && $body.hasClass("tv-ns-open")) {
                tree = treeNS;
            }
            if (typeof tree != "undefined") {
                var targetLink = tree.find("a.hovered");
                if (targetLink.length) {
                    var tooltip = tree.next(".tv-tooltip"),
                        arrow = tooltip.find(".arrow"),
                        targetRect = targetLink[0].getBoundingClientRect(),
                        treeRect = tree[0].getBoundingClientRect(),
                        targetV = {
                            right: $window.width() - targetRect.right,
                            bottom: $window.innerHeight() - targetRect.bottom,
                        },
                        treeV = {
                            right: $window.width() - treeRect.right,
                            bottom: $window.innerHeight() - treeRect.bottom,
                        };

                    // The maximum to the right the tooltip can be positioned without overlapping the viewport
                    var rightestLeft = $window.width() - tooltip.outerWidth() - 20;
                    var tooltipV = {
                        left: Math.max(20, Math.min(rightestLeft,
                            targetRect.left + (targetRect.width / 2) - (tooltip.outerWidth() / 2) + 8)),
                        top: targetRect.top - tooltip.outerHeight() - 24
                    };

                    var absoluteLeftSide = tooltipV.left + 15; // padding and border of the tooltip
                    var targetRectCenter = targetRect.left + targetRect.width / 2; //absolute center of target node
                    const borderWidth = 12
                    const arrowLongSide = Math.sqrt(borderWidth * borderWidth * 2)
                    // Speech bubble arrow positioned independently from tooltip rectangle
                    var arrowV = {
                        left: Math.min(Math.max((targetRectCenter - absoluteLeftSide - arrowLongSide), 0), (tooltip.width() - 24))
                    };
                    if (animate) {
                        tooltip.stop(true).animate({
                            "left": tooltipV.left,
                            "top": tooltipV.top
                        }, { duration: 250, queue: false });
                        arrow.stop(true).animate({
                            "left": arrowV.left,
                        }, { duration: 250, queue: false });
                    } else {
                        tooltip.css({
                            "left": tooltipV.left,
                            "top": tooltipV.top
                        });
                        arrow.css({
                            "left": arrowV.left,
                        });
                    }

                    if (((targetRect.left + (targetRect.width / 2)) < treeRect.left) ||
                        ((targetV.right + (targetRect.width / 2)) < treeV.right) ||
                        ((targetRect.top + (targetRect.height / 2)) < treeRect.top) ||
                        ((targetV.bottom + targetRect.height) < treeV.bottom) ||
                        ((tooltipV.left + tooltip.outerWidth()) < targetRect.right) ||
                        (tooltipV.left > targetRect.left)
                    ) {
                        // the node is scrolled outside of the view
                        tooltip.fadeOut(400);
                    } else {
                        tooltip.fadeIn(250);
                    }
                }
            }
        }


        function removeError() {
            if (args.normalView) {
                NS.children(".tv-show-fs").prop("disabled", false);
            }
        }

        function jqArrayToJqObject(arr) {
            //http://stackoverflow.com/a/11304274/2919731
            return $($.map(arr, function (el) {
                return el.get();
            }));
        }

        return this;
    }
}(jQuery));
