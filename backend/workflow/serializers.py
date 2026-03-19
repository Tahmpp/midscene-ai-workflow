from rest_framework import serializers
from .models import TestCase, GeneratedScript, TestRun, TestResult

class TestCaseSerializer(serializers.ModelSerializer):
    class Meta:
        model = TestCase
        fields = '__all__'

class GeneratedScriptSerializer(serializers.ModelSerializer):
    class Meta:
        model = GeneratedScript
        fields = '__all__'

class TestCaseBriefSerializer(serializers.ModelSerializer):
    """简化的测试用例序列化器，用于嵌套"""
    class Meta:
        model = TestCase
        fields = ['id', 'case_id', 'title', 'description']

class TestResultSerializer(serializers.ModelSerializer):
    test_case = TestCaseBriefSerializer(read_only=True)
    
    class Meta:
        model = TestResult
        fields = ['id', 'test_case', 'status', 'start_time', 'end_time', 
                  'duration', 'log_content', 'error_message', 'screenshot_path', 'video_path', 'report_path']

class TestRunSerializer(serializers.ModelSerializer):
    results = TestResultSerializer(many=True, read_only=True)

    class Meta:
        model = TestRun
        fields = '__all__'
