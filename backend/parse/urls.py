from django.urls import path, re_path

from .views import parse_post, parse_get, generate_xpath_view

urlpatterns = [
    path('parse-sentence/', parse_post, name='parse-sentence'),
    re_path(r'^parse-sentence/.+$', parse_get, name='parse-sentence-get'),
    path('generate-xpath/', generate_xpath_view, name='generate-xpath'),
]
